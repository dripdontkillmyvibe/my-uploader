import React, { useState, useEffect } from 'react';
import { User, KeyRound, CheckCircle } from 'lucide-react';

// Define the API URL based on the environment, just like in App.js
const API_URL = process.env.NODE_ENV === 'production' ? process.env.REACT_APP_API_URL : '';


// This is a placeholder for the Slack logo. 
// In a real app, you might use an SVG or an image file.
const SlackLogo = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15.5 6.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z"/>
        <path d="M8.5 17.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 1 0 0 5z"/>
        <path d="M17.5 15.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 1 1 0-5z"/>
        <path d="M6.5 8.5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 1 0 5 0z"/>
        <path d="m15.5 8.5-3 3"/>
        <path d="m6.5 15.5 3-3"/>
        <path d="m8.5 6.5 3 3"/>
        <path d="m17.5 17.5-3-3"/>
    </svg>
);

const ConnectedState = ({ slackUserId }) => (
    <div className="p-6 border rounded-xl bg-green-50 text-green-800 shadow-sm">
        <div className="flex items-center">
            <CheckCircle className="w-8 h-8 mr-4 text-green-600"/>
            <div>
                <h3 className="font-semibold text-lg">Connected to Slack</h3>
                <p className="text-sm">Your account is linked to Slack user <span className="font-mono bg-green-100 px-1 rounded">{slackUserId}</span>.</p>
                <p className="text-sm mt-1">You can now upload images by sharing them in any channel the bot is in.</p>
            </div>
        </div>
    </div>
);


const SlackIntegrationCard = ({ dashboardUser, portalUser, portalPass }) => {
    // State to manage the portal credentials input by the user
    const [localPortalUser, setLocalPortalUser] = useState(portalUser || '');
    const [localPortalPass, setLocalPortalPass] = useState(portalPass || '');
    const [isConnecting, setIsConnecting] = useState(false);

    const handleConnectClick = async () => {
        if (!dashboardUser || !localPortalUser || !localPortalPass) {
            alert("Please enter your portal username and password to connect Slack.");
            return;
        }

        setIsConnecting(true);

        try {
            const response = await fetch(`${API_URL}/api/slack/oauth/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: dashboardUser,
                    portalUser: localPortalUser,
                    portalPass: localPortalPass
                })
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Failed to start Slack connection.');
            }
            // Redirect the user to the Slack authorization URL
            window.location.href = data.slackAuthUrl;
        } catch (error) {
            alert(`Error: ${error.message}`);
            setIsConnecting(false);
        }
    };

    return (
        <div className="p-6 border rounded-xl bg-slate-50 shadow-sm">
            <div className="flex justify-between items-center">
                <div className="flex items-center">
                    <SlackLogo />
                    <h3 className="ml-4 font-semibold text-slate-800">
                        Connect to Slack
                    </h3>
                </div>
                <button 
                    onClick={handleConnectClick} 
                    disabled={isConnecting}
                    className="bg-[#4A154B] text-white font-bold py-2 px-4 rounded-lg hover:opacity-90 flex items-center disabled:bg-slate-400"
                >
                    {isConnecting ? 'Connecting...' : 'Add to Slack'}
                </button>
            </div>
            <p className="mt-4 text-sm text-slate-600">
                Enter your portal credentials below. This is a one-time setup to allow the bot to create upload jobs on your behalf.
            </p>
            <div className="mt-4 space-y-4">
                 <div>
                    <label className="font-medium text-slate-700 block mb-1">Portal Username</label>
                    <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"/><input type="text" value={localPortalUser} onChange={e => setLocalPortalUser(e.target.value)} className="w-full pl-10 p-3 border border-slate-300 rounded-lg"/></div>
                </div>
                <div>
                    <label className="font-medium text-slate-700 block mb-1">Portal Password</label>
                    <div className="relative"><KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"/><input type="password" value={localPortalPass} onChange={e => setLocalPortalPass(e.target.value)} className="w-full pl-10 p-3 border border-slate-300 rounded-lg"/></div>
                </div>
            </div>
        </div>
    );
};


export default function IntegrationsDashboard({ dashboardUser, portalUser, portalPass }) {
    const [integrationStatus, setIntegrationStatus] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchStatus = async () => {
            if (!dashboardUser) return;
            try {
                const response = await fetch(`${API_URL}/api/slack/integration-status?userId=${dashboardUser}`);
                if (response.ok) {
                    const data = await response.json();
                    setIntegrationStatus(data);
                }
            } catch (error) {
                console.error("Failed to fetch integration status", error);
            } finally {
                setIsLoading(false);
            }
        };
        fetchStatus();
    }, [dashboardUser]);

    if (isLoading) {
        return <p className="text-center text-slate-500">Loading integration status...</p>;
    }

    if (integrationStatus && integrationStatus.isConnected) {
        return (
            <div className="space-y-8">
                <ConnectedState slackUserId={integrationStatus.slackUserId} />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <SlackIntegrationCard dashboardUser={dashboardUser} portalUser={portalUser} portalPass={portalPass} />
            {/* We can add more integrations here in the future */}
        </div>
    );
} 