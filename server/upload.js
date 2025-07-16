const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
const { App } = require('@slack/bolt');
const axios = require('axios');
const crypto = require('crypto');

// TODO: In Render, add SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET to environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });


// Initialize Slack App
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});


const app = express();
const port = process.env.PORT || 3001;

// --- Database Setup ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initializeDb() {
  const client = await pool.connect();
  try {
    // Create 'jobs' table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        portal_credentials JSONB NOT NULL,
        images JSONB NOT NULL,
        settings JSONB NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'queued',
        progress VARCHAR(255),
        logs TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create 'slack_integrations' table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS slack_integrations (
        slack_user_id VARCHAR(255) PRIMARY KEY,
        dashboard_user_id VARCHAR(255) NOT NULL UNIQUE,
        access_token VARCHAR(255) NOT NULL,
        portal_credentials JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create a table to store temporary OAuth states
    await client.query(`
      CREATE TABLE IF NOT EXISTS oauth_state (
        state_value VARCHAR(255) PRIMARY KEY,
        dashboard_user_id VARCHAR(255) NOT NULL,
        portal_credentials JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Database initialized, tables are ready.');
  } finally {
    client.release();
  }
}

// --- Middleware & File Handling ---
app.use(cors());
const jsonBodyParser = express.json({ limit: '50mb' });
const uploadDir = path.join(__dirname, 'images_to_upload');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage: storage });


// --- Shared Constants ---
const LOGIN_URL = 'https://wi-charge.c3dss.com/Login';
const USERNAME_SELECTOR = '#username';
const PASSWORD_SELECTOR = '#password';
const LOGIN_BUTTON_SELECTOR = 'button[type="submit"]';
const DROPDOWN_SELECTOR = '#display';
const PREVIEW_AREA_SELECTOR = '#preview1';
const HIDDEN_FILE_INPUT_SELECTOR = '#fileInput1';
const UPLOAD_SUBMIT_BUTTON_SELECTOR = '#pushBtn1';
const STATUS_LOG_SELECTOR = '#statuslog';

// --- Shared puppeteer launch options ---
const puppeteerLaunchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
};


// --- Slack Event Listener ---
slackApp.event('file_shared', async ({ event, client, logger }) => {
  try {
    const slackUserId = event.user_id;
    console.log(`[SLACK-EVENT] Received file_shared event from user: ${slackUserId}`);

    // Step 1: Look up the user's integration details
    const dbClient = await pool.connect();
    let integrationDetails;
    try {
      const result = await dbClient.query('SELECT * FROM slack_integrations WHERE slack_user_id = $1', [slackUserId]);
      if (result.rows.length === 0) {
        console.log(`[SLACK-EVENT] No integration found for Slack user ${slackUserId}. Ignoring event.`);
        return;
      }
      integrationDetails = result.rows[0];
    } finally {
      dbClient.release();
    }
    
    // Step 2: Get file info from Slack to get the download URL
    const fileInfo = await client.files.info({
      token: integrationDetails.access_token,
      file: event.file_id,
    });

    if (!fileInfo.ok || !fileInfo.file.url_private_download) {
      console.error('[SLACK-EVENT] Could not get file info from Slack:', fileInfo.error);
      return;
    }

    // Step 3: Download the image using the authenticated URL
    const imageUrl = fileInfo.file.url_private_download;
    const imageResponse = await axios({
      method: 'get',
      url: imageUrl,
      responseType: 'stream',
      headers: {
        'Authorization': `Bearer ${integrationDetails.access_token}`,
      },
    });

    const fileExtension = path.extname(fileInfo.file.name) || '.jpg';
    const newFilename = `${Date.now()}-${slackUserId}${fileExtension}`;
    const imagePath = path.join(uploadDir, newFilename);
    const writer = fs.createWriteStream(imagePath);

    imageResponse.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log(`[SLACK-EVENT] Successfully downloaded file to ${imagePath}`);

    // Step 4: Get a valid display value by launching a temporary browser
    const portalUser = integrationDetails.portal_credentials.username;
    const portalPass = integrationDetails.portal_credentials.password;
    let displayValue;

    let tempBrowser = null;
    try {
        console.log(`[SLACK-EVENT] Launching temporary browser to fetch displays for ${portalUser}`);
        tempBrowser = await puppeteer.launch(puppeteerLaunchOptions);
        const page = await tempBrowser.newPage();
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
        await page.type(USERNAME_SELECTOR, portalUser);
        await page.type(PASSWORD_SELECTOR, portalPass);
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click(LOGIN_BUTTON_SELECTOR)]);
        await page.waitForSelector(DROPDOWN_SELECTOR);
        
        // Find the first option in the dropdown that is not the "Select a display" default (value="0")
        const firstOption = await page.$eval(`${DROPDOWN_SELECTOR} option:not([value="0"])`, opt => opt.value);
        
        if (!firstOption) {
            throw new Error('Could not find any valid displays for the user.');
        }
        displayValue = firstOption;
        console.log(`[SLACK-EVENT] Found valid display value: ${displayValue}`);
    } catch (e) {
        console.error(`[SLACK-EVENT] Failed to fetch display value headlessly: ${e.message}`);
        // TODO: Notify user in Slack about the failure
        return; // Stop processing if we can't get a display
    } finally {
        if (tempBrowser) await tempBrowser.close();
    }
    
    // Use the fetched display value to create the job
    const jobSettings = {
      interval: 0,
      cycle: false,
      displayValue: displayValue
    };

    const jobDbClient = await pool.connect();
    try {
      await jobDbClient.query(
        `INSERT INTO jobs (user_id, portal_credentials, images, settings, status, progress, logs)
         VALUES ($1, $2, $3, $4, 'queued', 'Job created via Slack.', NULL);`,
        [
          integrationDetails.dashboard_user_id,
          JSON.stringify({ username: portalUser, password: portalPass }),
          JSON.stringify([{ path: imagePath, originalname: fileInfo.file.name }]),
          JSON.stringify(jobSettings)
        ]
      );
      console.log(`[SLACK-EVENT] Successfully created job for user ${integrationDetails.dashboard_user_id}`);
      
      // Step 5: Send a confirmation message back to Slack
      await client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN, // Use the main bot token to post
        channel: event.channel_id,
        text: `Got it! I've created an upload job for your file: *${fileInfo.file.name}*`
      });

    } finally {
      jobDbClient.release();
    }

  } catch (error) {
    console.error(`[SLACK-EVENT] Error handling file_shared event: ${error.message}`);
    // Optionally send an error message back to the user in Slack
  }
});


// --- API Endpoints ---

// This new endpoint handles all incoming requests from Slack,
// including the one-time URL verification challenge.
app.post('/api/slack/events', express.json(), (req, res) => {
  // Manually handle the URL verification challenge
  if (req.body && req.body.type === 'url_verification') {
    console.log('[SLACK-SETUP] Responding to URL verification challenge.');
    res.status(200).send(req.body.challenge);
    return;
  }
  
  // For all other events, let the Slack app handler take over.
  // We first need to acknowledge the event to prevent Slack from retrying.
  res.status(200).send();

  // Then process the event asynchronously.
  slackApp.processEvent({ body: req.body, ack: () => {} }).catch((err) => {
    console.error(err);
  });
});

// --- Slack OAuth Flow Endpoints ---

// This is the URL the user will be redirected to from the "Add to Slack" button
app.post('/api/slack/oauth/start', jsonBodyParser, async (req, res) => {
  console.log('[SLACK-OAUTH] Received request to start OAuth flow.');
  const { userId, portalUser, portalPass } = req.body;

  if (!userId || !portalUser || !portalPass) {
    return res.status(400).json({ message: 'User ID and portal credentials are required.' });
  }

  const state = crypto.randomBytes(16).toString('hex');
  const client = await pool.connect();
  try {
    const credentials = { username: portalUser, password: portalPass };
    // NOTE: In a production app, credentials should be encrypted before storing.
    await client.query(
      'INSERT INTO oauth_state (state_value, dashboard_user_id, portal_credentials) VALUES ($1, $2, $3)', 
      [state, userId, JSON.stringify(credentials)]
    );
    
    const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=channels:history,chat:write,files:read&user_scope=&state=${state}`;
    res.status(200).json({ slackAuthUrl });
  } catch (error) {
    console.error('[SLACK-OAUTH] Error starting OAuth flow:', error);
    res.status(500).json({ message: 'Could not start the Slack OAuth process.' });
  } finally {
    client.release();
  }
});

// After the user approves on Slack, they are sent back to this URL
app.get('/api/slack/oauth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!state) {
    return res.status(400).send('<h1>Error</h1><p>No state value was provided by Slack. Authorization failed.</p>');
  }
  
  const client = await pool.connect();
  try {
    // Verify the state value to prevent CSRF attacks
    const stateResult = await client.query('SELECT dashboard_user_id, portal_credentials FROM oauth_state WHERE state_value = $1', [state]);
    if (stateResult.rows.length === 0) {
      return res.status(403).send('<h1>Error</h1><p>Invalid state. Your authorization session may have expired. Please try again.</p>');
    }
    const { dashboard_user_id, portal_credentials } = stateResult.rows[0];

    // Exchange the temporary code for a permanent access token
    const oauthResult = await slackApp.client.oauth.v2.access({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code: code,
    });

    const slackUserId = oauthResult.authed_user.id;
    const accessToken = oauthResult.access_token;
    
    // Save the new integration, or update if it already exists for this dashboard user
    await client.query(
      `INSERT INTO slack_integrations (slack_user_id, dashboard_user_id, access_token, portal_credentials)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (dashboard_user_id) DO UPDATE SET slack_user_id = $1, access_token = $3, portal_credentials = $4;`,
      [slackUserId, dashboard_user_id, accessToken, portal_credentials]
    );

    console.log(`[SLACK-OAUTH] Successfully linked Slack user ${slackUserId} to dashboard user ${dashboard_user_id}.`);

    // Clean up the used state value
    await client.query('DELETE FROM oauth_state WHERE state_value = $1', [state]);

    res.send('<h1>Slack integration successful!</h1><p>Your account is now linked. You can close this window.</p>');

  } catch (error) {
    // Enhanced error logging to see the specific message from Slack
    console.error('[SLACK-OAUTH] callback error:', error);
    if (error.data) {
        console.error('[SLACK-OAUTH] Error data from Slack:', JSON.stringify(error.data, null, 2));
    }
    res.status(500).send('<h1>Error</h1><p>Something went wrong during the Slack integration. Please try again.</p>');
  } finally {
    client.release();
  }
});


// --- Slack Integration Status Endpoint ---
app.get('/api/slack/integration-status', async (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ message: 'User ID is required.' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query('SELECT slack_user_id FROM slack_integrations WHERE dashboard_user_id = $1', [userId]);
    if (result.rows.length > 0) {
      res.json({ isConnected: true, slackUserId: result.rows[0].slack_user_id });
    } else {
      res.json({ isConnected: false });
    }
  } catch (error) {
    console.error(`[SLACK-STATUS] Error checking integration status for ${userId}:`, error);
    res.status(500).json({ message: 'Failed to get integration status.' });
  } finally {
    client.release();
  }
});


app.post('/api/fetch-displays', jsonBodyParser, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Username and password are required.' });

    console.log('🤖 Fetching displays for user:', username);
    let browser = null;
    try {
        browser = await puppeteer.launch(puppeteerLaunchOptions);
        const page = await browser.newPage();
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
        await page.type(USERNAME_SELECTOR, username);
        await page.type(PASSWORD_SELECTOR, password);
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click(LOGIN_BUTTON_SELECTOR)]);
        await page.waitForSelector(DROPDOWN_SELECTOR);
        const options = await page.$$eval(`${DROPDOWN_SELECTOR} option`, opts => opts.map(o => ({ value: o.value, text: o.innerText })).filter(o => o.value && o.value !== "0"));
        res.json(options);
    } catch (error) {
        console.error('❌ Error fetching displays:', error);
        res.status(500).json({ message: 'Failed to fetch displays. Please check credentials.' });
    } finally {
        if (browser) await browser.close();
    }
});

// --- MTA Subway Widget API Endpoint ---
app.post('/api/get-subway-data', async (req, res) => {
    console.log('[MTA-WIDGET] Received request for /api/get-subway-data.');
    // Corrected based on user feedback. This endpoint does not require an API key.
    // Feed for N,Q,R,W lines. Other feeds are available for other lines.
    const feedUrl = `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw`;

    try {
        const response = await fetch(feedUrl); // No API key needed for this direct feed URL.
        console.log(`[MTA-WIDGET] Fetched from MTA. Status: ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[MTA-WIDGET] MTA API request failed:', response.status, errorText);
            return res.status(response.status).json({ message: `Failed to fetch data from MTA: ${errorText}` });
        }

        const buffer = await response.arrayBuffer();
        console.log(`[MTA-WIDGET] Received buffer of size: ${buffer.byteLength}`);
        
        const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
        console.log('[MTA-WIDGET] Successfully decoded feed message.');
        // Log a small sample of the feed to see its structure
        if (feed.entity && feed.entity.length > 0) {
            console.log('[MTA-WIDGET] Sample entity:', JSON.stringify(feed.entity[0], null, 2));
        }

        const arrivals = feed.entity
            .filter(entity => entity && entity.tripUpdate && entity.tripUpdate.stopTimeUpdate)
            .flatMap(entity => 
                entity.tripUpdate.stopTimeUpdate.map(update => ({
                    routeId: entity.tripUpdate.trip ? entity.tripUpdate.trip.routeId : 'N/A',
                    stopId: update.stopId,
                    arrival: update.arrival && update.arrival.time ? new Date(update.arrival.time.low * 1000) : null,
                }))
            )
            .filter(arrival => arrival.arrival && arrival.arrival > new Date()) // Only future arrivals
            .sort((a, b) => a.arrival - b.arrival) // Sort by soonest
            .slice(0, 10); // Limit to the next 10 arrivals
        
        console.log(`[MTA-WIDGET] Processed ${arrivals.length} arrivals. Sending response.`);
        res.json(arrivals);

    } catch (error) {
        console.error('❌ [MTA-WIDGET] CRITICAL ERROR in /api/mta-status:', error);
        res.status(500).json({ message: 'Server error while processing MTA data.', details: error.message });
    }
});


app.post('/api/fetch-display-details', jsonBodyParser, async (req, res) => {
    const { username, password, displayValue } = req.body;
    if (!username || !password || !displayValue) return res.status(400).json({ message: 'Missing required fields.' });

    let browser = null;
    try {
        browser = await puppeteer.launch(puppeteerLaunchOptions);
        const page = await browser.newPage();
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
        await page.type(USERNAME_SELECTOR, username);
        await page.type(PASSWORD_SELECTOR, password);
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click(LOGIN_BUTTON_SELECTOR)]);
        await page.waitForSelector(DROPDOWN_SELECTOR);
        await page.select(DROPDOWN_SELECTOR, displayValue);
        await new Promise(resolve => setTimeout(resolve, 2000));

        const imageUrl = await page.$eval(PREVIEW_AREA_SELECTOR, el => {
            const style = el.style.backgroundImage;
            const match = style.match(/url\("?(.+?)"?\)/);
            return match ? match[1] : null;
        });

        if (imageUrl) {
            const fullUrl = new URL(imageUrl, LOGIN_URL).href;
            res.json({ imageUrl: fullUrl });
        } else {
            res.json({ imageUrl: null });
        }
    } catch (error) {
        console.error('❌ Error fetching display details:', error);
        res.status(500).json({ message: 'Failed to fetch display details.' });
    } finally {
        if (browser) await browser.close();
    }
});

app.post('/api/create-job', upload.array('images'), async (req, res) => {
    const { userId, portalUser, portalPass, interval, cycle, displayValue } = req.body;
    const images = req.files.map(f => ({ path: f.path, originalname: f.originalname }));

    if (!userId || !portalUser || !portalPass || !displayValue || images.length === 0) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    const client = await pool.connect();
    try {
        const result = await client.query(
            `INSERT INTO jobs (user_id, portal_credentials, images, settings, status, progress, logs)
             VALUES ($1, $2, $3, $4, 'queued', 'Job created and waiting to be processed.', NULL) RETURNING id;`,
            [
                userId,
                JSON.stringify({ username: portalUser, password: portalPass }),
                JSON.stringify(images),
                JSON.stringify({ interval, cycle: cycle === 'true', displayValue })
            ]
        );
        const jobId = result.rows[0].id;
        res.status(201).json({ message: 'Automation job created successfully.', jobId });
    } catch (error) {
        console.error("Error creating job:", error);
        res.status(500).json({ message: 'Failed to create job.' });
    } finally {
        client.release();
    }
});

app.get('/api/job-status/:userId', async (req, res) => {
    const { userId } = req.params;
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT id, status, progress, logs FROM jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [userId]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ message: 'No job found for this user.' });
        }
    } finally {
        client.release();
    }
});

app.post('/api/stop-job/:jobId', async (req, res) => {
    const { jobId } = req.params;
    if (!jobId) {
        return res.status(400).json({ message: 'Job ID is required.' });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(
            `UPDATE jobs SET status = 'cancelled', progress = 'Job cancelled by user.' WHERE id = $1 AND (status = 'running' OR status = 'queued') RETURNING id`,
            [jobId]
        );
        if (result.rowCount > 0) {
            console.log(`Job ${jobId} has been marked for cancellation.`);
            res.status(200).json({ message: 'Job cancellation request sent successfully.' });
        } else {
            res.status(404).json({ message: 'Job not found or already completed/failed.' });
        }
    } catch (error) {
        console.error(`Error stopping job ${jobId}:`, error);
        res.status(500).json({ message: 'Failed to stop job.' });
    } finally {
        client.release();
    }
});

// --- Worker Logic ---
async function processJob(job) {
    const client = await pool.connect();
    let browser = null;
    try {
        const credentials = job.portal_credentials;
        const settings = job.settings;
        const images = job.images;
        
        console.log(`[Job ${job.id}] Starting...`);
        await client.query("UPDATE jobs SET progress = 'Logging into portal...' WHERE id = $1", [job.id]);
        
        browser = await puppeteer.launch(puppeteerLaunchOptions);
        const page = await browser.newPage();
        
        console.log(`[Job ${job.id}] Navigating to login page.`);
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle2' });
        await page.type(USERNAME_SELECTOR, credentials.username);
        await page.type(PASSWORD_SELECTOR, credentials.password);
        
        console.log(`[Job ${job.id}] Submitting login form.`);
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click(LOGIN_BUTTON_SELECTOR)]);
        
        const dashboardUrl = page.url();
        console.log(`[Job ${job.id}] Logged in. Dashboard URL is: ${dashboardUrl}`);
        
        let isFirstImageOfJob = true;

        do {
          for (let i = 0; i < images.length; i++) {
              console.log(`[Job ${job.id}] Starting loop for image ${i + 1}.`);
              const jobCheckResult = await client.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
              if (jobCheckResult.rows[0].status !== 'running') {
                  console.log(`[Job ${job.id}] Status changed to '${jobCheckResult.rows[0].status}'. Halting execution.`);
                  return;
              }

              if (!isFirstImageOfJob) {
                  const resetMsg = `Resetting page for image ${i + 1}...`;
                  console.log(`[Job ${job.id}] ${resetMsg}`);
                  await client.query("UPDATE jobs SET progress = $1 WHERE id = $2", [resetMsg, job.id]);
                  await page.goto(dashboardUrl, { waitUntil: 'networkidle2' });
                  console.log(`[Job ${job.id}] Page reset complete.`);
              }
              isFirstImageOfJob = false;

              const selectDisplayMsg = `Selecting display for image ${i + 1}...`;
              console.log(`[Job ${job.id}] ${selectDisplayMsg}`);
              await client.query("UPDATE jobs SET progress = $1 WHERE id = $2", [selectDisplayMsg, job.id]);
              await page.waitForSelector(DROPDOWN_SELECTOR, { timeout: 30000 });
              await page.select(DROPDOWN_SELECTOR, settings.displayValue);
              console.log(`[Job ${job.id}] Display selected.`);

              const image = images[i];
              const progressMessage = `Uploading image ${i + 1} of ${images.length}: ${image.originalname}`;
              console.log(`[Job ${job.id}] ${progressMessage}`);
              await client.query(`UPDATE jobs SET progress = $1 WHERE id = $2`, [progressMessage, job.id]);
              
              console.log(`[Job ${job.id}] Waiting for file input selector...`);
              const fileInput = await page.waitForSelector(HIDDEN_FILE_INPUT_SELECTOR, { timeout: 30000 });
              console.log(`[Job ${job.id}] File input found. Uploading file: ${image.path}`);
              
              await fileInput.uploadFile(image.path);
              console.log(`[Job ${job.id}] File selected for upload.`);
              
              console.log(`[Job ${job.id}] Waiting for upload button to be enabled...`);
              await page.waitForFunction(
                (selector) => {
                  const el = document.querySelector(selector);
                  return el && !el.disabled;
                },
                { timeout: 15000 },
                UPLOAD_SUBMIT_BUTTON_SELECTOR
              );
              console.log(`[Job ${job.id}] Upload button is enabled.`);

              let clickSuccessful = false;
              for (let attempt = 0; attempt < 10; attempt++) {
                  try {
                      console.log(`[Job ${job.id}] Attempting to click upload button (Attempt ${attempt + 1})...`);
                      await page.click(UPLOAD_SUBMIT_BUTTON_SELECTOR);
                      clickSuccessful = true;
                      console.log(`[Job ${job.id}] Click successful.`);
                      break;
                  } catch (e) {
                      if (e.message.includes('not clickable')) {
                          console.log(`[Job ${job.id}] Attempt ${attempt + 1}: Upload button not clickable, retrying...`);
                          await new Promise(resolve => setTimeout(resolve, 1000));
                      } else {
                          throw e;
                      }
                  }
              }

              if (!clickSuccessful) {
                  throw new Error(`The upload button was enabled but not clickable after 10 retries.`);
              }
              
              const waitConfirmMsg = 'Waiting for upload confirmation...';
              console.log(`[Job ${job.id}] ${waitConfirmMsg}`);
              await client.query("UPDATE jobs SET progress = $1 WHERE id = $2", [waitConfirmMsg, job.id]);
              
              // Wait a moment for the initial "uploading..." message to appear.
              await new Promise(resolve => setTimeout(resolve, 3000));
              console.log(`[Job ${job.id}] Initial 3s wait finished. Now checking for final confirmation.`);

              // Get the log count *after* the initial message has likely appeared.
              const logCountAfterInitialMsg = await page.$$eval(`${STATUS_LOG_SELECTOR} p`, ps => ps.length).catch(() => 0);
              console.log(`[Job ${job.id}] Log count after initial wait: ${logCountAfterInitialMsg}`);

              // Now, wait for a *new* log entry beyond that count.
              await page.waitForFunction(
                (selector, initialCount) => {
                    const logEntries = document.querySelectorAll(`${selector} p`);
                    return logEntries.length > initialCount;
                },
                { timeout: 120000 },
                STATUS_LOG_SELECTOR,
                logCountAfterInitialMsg
              ).catch(e => {
                  throw new Error('Timed out waiting for a new confirmation entry in the status log.');
              });
              console.log(`[Job ${job.id}] New final confirmation log entry detected.`);

              const logs = await page.$eval(STATUS_LOG_SELECTOR, el => el.innerHTML);
              await client.query("UPDATE jobs SET logs = $1 WHERE id = $2", [logs, job.id]);
              console.log(`[Job ${job.id}] Logs saved to database.`);

              const lastLogEntry = await page.$eval(`${STATUS_LOG_SELECTOR} p:last-child`, el => el.innerText.toLowerCase());
              console.log(`[Job ${job.id}] Last log entry: "${lastLogEntry}"`);

              if (lastLogEntry.includes('failed') || lastLogEntry.includes('error')) {
                  throw new Error(`The portal reported an error on the last log entry: "${lastLogEntry}"`);
              }
              
              const waitTime = (parseInt(settings.interval, 10) || 0) * 60 * 1000;
              if (waitTime > 0 && (i < images.length - 1 || settings.cycle)) { 
                const waitMsg = `Waiting for ${settings.interval} minute(s)...`;
                console.log(`[Job ${job.id}] ${waitMsg}`);
                await client.query(`UPDATE jobs SET progress = $1 WHERE id = $2`, [waitMsg, job.id]);
                await new Promise(resolve => setTimeout(resolve, waitTime));
              }
          }
        } while (settings.cycle);

        console.log(`[Job ${job.id}] All images processed successfully.`);
        await client.query("UPDATE jobs SET status = 'completed', progress = 'All images uploaded successfully.' WHERE id = $1", [job.id]);
    } catch (error) {
        console.error(`[Job ${job.id}] Error processing job:`, error);
        const errorMessage = error.message.includes('click') || error.message.includes('clickable')
            ? `A button on the page was not clickable. The website layout may have changed or an overlay was present. (Selector: ${UPLOAD_SUBMIT_BUTTON_SELECTOR})`
            : error.message;
        await client.query("UPDATE jobs SET status = 'failed', progress = $2 WHERE id = $1", [job.id, `An error occurred: ${errorMessage}`]);
    } finally {
        if (browser) {
            console.log(`[Job ${job.id}] Closing browser.`);
            await browser.close();
        }
        console.log(`[Job ${job.id}] Cleaning up image files.`);
        job.images.forEach(img => fs.unlink(img.path, (err) => {
            if(err) console.error(`[Job ${job.id}] Error deleting file:`, img.path, err);
        }));
        client.release();
    }
}

async function checkAndProcessJobs() {
    const client = await pool.connect();
    try {
        const query = `
            UPDATE jobs
            SET status = 'running', progress = 'Starting job processing...'
            WHERE id = (
                SELECT id
                FROM jobs
                WHERE status = 'queued'
                ORDER BY created_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING *;
        `;
        const { rows } = await client.query(query);

        if (rows.length > 0) {
            const job = rows[0];
            console.log(`Picked up job ${job.id} to process.`);
            processJob(job).catch(err => {
                console.error(`Unhandled exception in processJob for job ${job.id}:`, err);
            });
        }
    } catch (error) {
        console.error("Error in job checker:", error);
    } finally {
        client.release();
    }
}

// Start the server after DB initialization
initializeDb().then(() => {
    setInterval(checkAndProcessJobs, 5000);
    app.listen(port, () => {
        console.log(`🚀 Stateful automation server listening on port ${port}`);
        console.log('⚡️ Slack Bolt event handler is ready.');
    });
}).catch(e => console.error("Failed to initialize database:", e));
