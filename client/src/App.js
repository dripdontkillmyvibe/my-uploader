import React, { useState, useRef, useEffect, useCallback } from 'react';
import { User, KeyRound, UploadCloud, GripVertical, Clock, PlayCircle, X, LogIn, Activity, ListVideo, ImageIcon, ChevronRight, Loader2, AlertTriangle, StopCircle, Crop, RectangleHorizontal, RectangleVertical, LayoutGrid, Link } from 'lucide-react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import WidgetsDashboard from './Widgets'; // Import the new component
import IntegrationsDashboard from './Integrations'; // Import the new component

// --- Define the API URL based on the environment ---
// In production (Netlify), it uses the full URL from the environment variable.
// In development, it's an empty string, so requests are relative paths handled by the proxy.
const API_URL = process.env.NODE_ENV === 'production' ? process.env.REACT_APP_API_URL : '';


// --- Error Boundary Component ---
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ error: error, errorInfo: errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-xl p-8 space-y-4 text-center">
            <AlertTriangle className="mx-auto h-16 w-16 text-red-500" />
            <h1 className="text-2xl font-bold text-red-600">Application Error</h1>
            <p className="text-slate-600">Something went wrong. Please copy the details below and report this issue.</p>
            <details className="p-4 bg-slate-100 rounded-lg text-left text-sm font-mono overflow-auto">
                <summary className="cursor-pointer font-sans font-bold">Error Details</summary>
                <pre>
                    {this.state.error && this.state.error.toString()}
                    <br />
                    {this.state.errorInfo && this.state.errorInfo.componentStack}
                </pre>
            </details>
        </div>
      );
    }

    return this.props.children; 
  }
}

// --- Image Editor Component ---
const ImageEditor = ({ image, onSave, onCancel }) => {
    const [crop, setCrop] = useState({ aspect: 2560 / 1440 });
    const [completedCrop, setCompletedCrop] = useState(null);
    const [orientation, setOrientation] = useState('landscape');
    const imgRef = useRef(null);

    useEffect(() => {
        setCrop({ aspect: 2560 / 1440 });
        setCompletedCrop(null);
        setOrientation('landscape');
    }, [image]);


    const handleSave = async () => {
        if (completedCrop?.width && completedCrop?.height && imgRef.current) {
            const canvas = document.createElement('canvas');
            const scaleX = imgRef.current.naturalWidth / imgRef.current.width;
            const scaleY = imgRef.current.naturalHeight / imgRef.current.height;
            
            if (orientation === 'portrait') {
                canvas.width = 1440;
                canvas.height = 2560;
            } else {
                canvas.width = 2560;
                canvas.height = 1440;
            }

            const ctx = canvas.getContext('2d');

            ctx.drawImage(
                imgRef.current,
                completedCrop.x * scaleX,
                completedCrop.y * scaleY,
                completedCrop.width * scaleX,
                completedCrop.height * scaleY,
                0,
                0,
                canvas.width,
                canvas.height
            );
            
            canvas.toBlob((blob) => {
                onSave(blob);
            }, 'image/png', 1);
        }
    };

    const toggleOrientation = (newOrientation) => {
        setOrientation(newOrientation);
        if (newOrientation === 'landscape') {
            setCrop({ aspect: 2560 / 1440 });
        } else {
            setCrop({ aspect: 1440 / 2560 });
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl max-w-4xl w-full">
                <h2 className="text-2xl font-bold mb-4">Crop & Resize Image</h2>
                <div className="flex justify-center space-x-4 mb-4">
                    <button onClick={() => toggleOrientation('landscape')} className={`flex items-center px-4 py-2 rounded-lg font-semibold ${orientation === 'landscape' ? 'bg-brand-blue text-white' : 'bg-slate-200'}`}>
                        <RectangleHorizontal className="mr-2 h-5 w-5"/> Landscape (2560x1440)
                    </button>
                    <button onClick={() => toggleOrientation('portrait')} className={`flex items-center px-4 py-2 rounded-lg font-semibold ${orientation === 'portrait' ? 'bg-brand-blue text-white' : 'bg-slate-200'}`}>
                        <RectangleVertical className="mr-2 h-5 w-5"/> Portrait (1440x2560)
                    </button>
                </div>
                <div className="max-h-[60vh] overflow-y-auto flex justify-center">
                    <ReactCrop crop={crop} onChange={c => setCrop(c)} onComplete={c => setCompletedCrop(c)} aspect={orientation === 'landscape' ? 2560 / 1440 : 1440 / 2560}>
                        <img ref={imgRef} src={image.preview} alt="Crop preview" style={{maxHeight: '55vh'}} />
                    </ReactCrop>
                </div>
                <div className="flex justify-end space-x-4 mt-4">
                    <button onClick={onCancel} className="bg-slate-300 text-slate-800 font-bold py-2 px-4 rounded-lg hover:bg-slate-400">Cancel</button>
                    <button onClick={handleSave} className="bg-brand-blue text-white font-bold py-2 px-4 rounded-lg hover:opacity-90">Save</button>
                </div>
            </div>
        </div>
    );
};


// --- Main App Component ---
export default function App() {
  // --- State Management ---
  const [appStep, setAppStep] = useState('loading'); // loading, login, portalSetup, dashboard
  const [dashboardUser, setDashboardUser] = useState('');
  const [inputUser, setInputUser] = useState('');
  
  const [portalUser, setPortalUser] = useState('');
  const [portalPass, setPortalPass] = useState('');

  const [displayOptions, setDisplayOptions] = useState([]);
  const [selectedDisplay, setSelectedDisplay] = useState('');
  const [currentImageUrl, setCurrentImageUrl] = useState(null);

  const [images, setImages] = useState([]);
  const [uploadInterval, setUploadInterval] = useState(30);
  const [cycle, setCycle] = useState(false);
  
  const [jobStatus, setJobStatus] = useState(null);
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  
  const [editingImage, setEditingImage] = useState(null);
  const [activeTab, setActiveTab] = useState('automation'); // 'automation', 'widgets', or 'integrations'

  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  const handleSelectDisplay = useCallback(async (displayValue, user, pass) => {
    setSelectedDisplay(displayValue);
    setCurrentImageUrl(null);
    if (!displayValue) return;
    try {
        const response = await fetch(`${API_URL}/api/fetch-display-details`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass, displayValue }),
        });
        const data = await response.json();
        if (data.imageUrl) setCurrentImageUrl(data.imageUrl);
    } catch (error) { console.error("Could not fetch display image", error); }
  }, []);

  const loadDashboardData = useCallback(async (user, pass) => {
    setStatus('processing');
    setMessage('Logging in and fetching your displays...');
    try {
      const response = await fetch(`${API_URL}/api/fetch-displays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const options = await response.json();
      if (!response.ok) throw new Error(options.message || 'Failed to fetch.');
      
      if (!Array.isArray(options)) { 
        throw new Error('Received unexpected data from server.');
      }
      
      setDisplayOptions(options);
      
      if (options.length > 0 && options[0].value) {
        await handleSelectDisplay(options[0].value, user, pass);
      }
      
      setStatus('idle');
      setMessage('');
      return true; // Indicate success

    } catch (error) {
      setStatus('error');
      setMessage(error.message);
      return false; // Indicate failure
    }
  }, [handleSelectDisplay]);

  // Combined useEffect for initialization
  useEffect(() => {
    const initializeApp = async () => {
      const storedUser = localStorage.getItem('dashboardUser');
      if (storedUser) {
        setDashboardUser(storedUser);
        const storedPortalUser = localStorage.getItem(`${storedUser}_portalUser`);
        const storedPortalPass = localStorage.getItem(`${storedUser}_portalPass`);
        
        if (storedPortalUser && storedPortalPass) {
          setPortalUser(storedPortalUser);
          setPortalPass(storedPortalPass);
          const success = await loadDashboardData(storedPortalUser, storedPortalPass);
          if (success) {
            setAppStep('dashboard');
          } else {
            setAppStep('portalSetup');
          }
        } else {
          setAppStep('portalSetup');
        }
      } else {
        setAppStep('login');
      }
    };
    initializeApp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect to poll for job status
  useEffect(() => {
    if (appStep !== 'dashboard' || !dashboardUser) return;
    const fetchStatus = async () => {
      try {
        const response = await fetch(`${API_URL}/api/job-status/${dashboardUser}`);
        if(response.ok) setJobStatus(await response.json());
        else setJobStatus(null);
      } catch (error) { console.error("Failed to fetch job status", error); }
    };
    fetchStatus();
    const intervalId = setInterval(fetchStatus, 5000); // Poll more frequently for logs
    return () => clearInterval(intervalId);
  }, [appStep, dashboardUser]);

  // Effect to clean up ALL image preview URLs when the component unmounts
  useEffect(() => {
    return () => {
      images.forEach(image => URL.revokeObjectURL(image.preview));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  const handleDashboardLogin = () => {
    if (inputUser) {
      localStorage.setItem('dashboardUser', inputUser);
      setDashboardUser(inputUser);
      setAppStep('portalSetup');
    }
  };

  const handleSavePortalCredentials = async () => {
    if (!portalUser || !portalPass) {
      setStatus('error');
      setMessage('Please enter portal credentials.');
      return;
    }
    const success = await loadDashboardData(portalUser, portalPass);
    if (success) {
      localStorage.setItem(`${dashboardUser}_portalUser`, portalUser);
      localStorage.setItem(`${dashboardUser}_portalPass`, portalPass);
      setAppStep('dashboard');
    }
  };

  const handleStartAutomation = async () => {
    if (!selectedDisplay || images.length === 0) {
      setStatus('error');
      setMessage('Please select a display and upload at least one image.');
      return;
    }
    setStatus('processing');
    setMessage('Submitting job to the server...');
    
    const formData = new FormData();
    formData.append('userId', dashboardUser);
    formData.append('portalUser', portalUser);
    formData.append('portalPass', portalPass);
    formData.append('interval', uploadInterval);
    formData.append('cycle', cycle);
    formData.append('displayValue', selectedDisplay);
    images.forEach(img => formData.append('images', img.file));

    try {
        const response = await fetch(`${API_URL}/api/create-job`, {
            method: 'POST',
            body: formData,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message);
        setStatus('success');
        setMessage(result.message);
    } catch (error) {
      setStatus('error');
      setMessage(`Job submission failed: ${error.message}`);
    }
  };

  const handleStopJob = async () => {
    if (!jobStatus || !jobStatus.id) return;

    try {
        const response = await fetch(`${API_URL}/api/stop-job/${jobStatus.id}`, {
            method: 'POST',
        });
        if (response.ok) {
            setMessage('Cancellation request sent. The job will stop shortly.');
        } else {
            const result = await response.json();
            setMessage(`Error: ${result.message || 'Could not stop the job.'}`);
        }
    } catch (error) {
        console.error("Failed to send stop job request", error);
        setMessage('Failed to send stop job request.');
    }
  };

  const handleFileChange = (e) => {
    try {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      const newImages = files.map(file => ({
        file,
        id: crypto.randomUUID(),
        preview: URL.createObjectURL(file)
      }));
      setImages(prev => [...prev, ...newImages]);
    } catch (error) {
      console.error("Error handling file change:", error);
      setStatus('error');
      setMessage('There was an error processing the selected files.');
    }
  };

  const removeImage = (id) => {
    setImages(prevImages => {
      const imageToRemove = prevImages.find(img => img.id === id);
      if (imageToRemove) {
        URL.revokeObjectURL(imageToRemove.preview);
      }
      return prevImages.filter(image => image.id !== id);
    });
  };

  const handleDragSort = () => {
    let _images = [...images];
    const draggedItemContent = _images.splice(dragItem.current, 1)[0];
    if (!draggedItemContent) return;
    _images.splice(dragOverItem.current, 0, draggedItemContent);
    dragItem.current = null;
    dragOverItem.current = null;
    setImages(_images);
  };

  const handleSaveCroppedImage = (blob) => {
    const newFile = new File([blob], editingImage.file.name, { type: 'image/png' });
    const newPreviewUrl = URL.createObjectURL(newFile);
    
    setImages(prevImages => {
      const imageToUpdate = prevImages.find(img => img.id === editingImage.id);
      if (imageToUpdate) {
        URL.revokeObjectURL(imageToUpdate.preview);
      }
      return prevImages.map(img => 
        img.id === editingImage.id 
        ? { ...img, file: newFile, preview: newPreviewUrl } 
        : img
      );
    });

    setEditingImage(null);
  };
  
  const renderContent = () => {
    if (appStep === 'loading') {
        return (
            <div className="flex flex-col items-center justify-center text-slate-500">
                <Loader2 className="w-12 h-12 animate-spin" />
                <p className="mt-4 text-lg">Initializing Application...</p>
            </div>
        );
    }

    if (appStep === 'login') {
      return (
        <div className="w-full max-w-sm mx-auto bg-white rounded-2xl shadow-xl p-8 space-y-6">
          <h1 className="text-2xl font-bold text-center text-slate-800">Dashboard Login</h1>
          <p className="text-center text-sm text-slate-500">Enter a username to create or access your automation dashboard.</p>
          <div>
            <label className="font-medium text-slate-700 block mb-1">Your Username</label>
            <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"/><input type="text" value={inputUser} onChange={e => setInputUser(e.target.value)} className="w-full pl-10 p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-blue"/></div>
          </div>
          <button onClick={handleDashboardLogin} className="w-full bg-brand-blue text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center hover:opacity-90">
            <span className="flex items-center justify-center">Login <LogIn className="ml-2 w-5 h-5"/></span>
          </button>
        </div>
      );
    }

    if (appStep === 'portalSetup') {
      return (
        <div className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-xl p-8 space-y-6">
          <h1 className="text-2xl font-bold text-center text-slate-800">Portal Setup</h1>
          <p className="text-center text-sm text-slate-500">Enter your C3DSS portal credentials. This is a one-time setup.</p>
          <div>
            <label className="font-medium text-slate-700 block mb-1">Portal Username</label>
            <div className="relative"><User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"/><input type="text" value={portalUser} onChange={e => setPortalUser(e.target.value)} className="w-full pl-10 p-3 border border-slate-300 rounded-lg"/></div>
          </div>
          <div>
            <label className="font-medium text-slate-700 block mb-1">Portal Password</label>
            <div className="relative"><KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"/><input type="password" value={portalPass} onChange={e => setPortalPass(e.target.value)} className="w-full pl-10 p-3 border border-slate-300 rounded-lg"/></div>
          </div>
          <button onClick={handleSavePortalCredentials} disabled={status === 'processing'} className="w-full bg-brand-blue text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center hover:opacity-90 disabled:bg-slate-400">
            <span className="flex items-center justify-center">
              {status === 'processing' ? 'Verifying...' : 'Save & Continue'} <ChevronRight className="ml-2 w-5 h-5"/>
            </span>
          </button>
          {message && <p className="text-center text-sm font-medium text-red-600">{message}</p>}
        </div>
      );
    }

    if (appStep === 'dashboard') {
      const isJobActive = jobStatus && (jobStatus.status === 'running' || jobStatus.status === 'queued');
      return (
        <>
          {editingImage && <ImageEditor key={editingImage.id} image={editingImage} onSave={handleSaveCroppedImage} onCancel={() => setEditingImage(null)} />}
          <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-xl p-8 space-y-8">
            <header className="text-center">
              <h1 className="text-4xl font-bold text-slate-800">Automation Dashboard</h1>
              <p className="text-slate-500 mt-2">Welcome, {dashboardUser}</p>
            </header>

            {/* --- Tab Navigation --- */}
            <div className="flex border-b border-slate-200 -mb-4">
                <button onClick={() => setActiveTab('automation')} className={`flex items-center space-x-2 px-4 py-2 text-sm font-semibold transition-colors ${activeTab === 'automation' ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-slate-500 hover:bg-slate-100'}`}>
                    <PlayCircle className="w-5 h-5" />
                    <span>Automation</span>
                </button>
                <button onClick={() => setActiveTab('widgets')} className={`flex items-center space-x-2 px-4 py-2 text-sm font-semibold transition-colors ${activeTab === 'widgets' ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-slate-500 hover:bg-slate-100'}`}>
                    <LayoutGrid className="w-5 h-5" />
                    <span>Widgets</span>
                </button>
                <button onClick={() => setActiveTab('integrations')} className={`flex items-center space-x-2 px-4 py-2 text-sm font-semibold transition-colors ${activeTab === 'integrations' ? 'border-b-2 border-brand-blue text-brand-blue' : 'text-slate-500 hover:bg-slate-100'}`}>
                    <Link className="w-5 h-5" />
                    <span>Integrations</span>
                </button>
            </div>

            {/* --- Conditional Content --- */}
            {activeTab === 'automation' && (
              <>
                <div className="p-4 border rounded-lg bg-slate-50">
                  <h2 className="font-semibold text-slate-700 flex items-center"><Activity className="w-5 h-5 mr-2 text-slate-500"/>Current Job Status</h2>
                  <div className="mt-2 text-center">
                    {jobStatus && typeof jobStatus.status === 'string' ? (
                      <>
                        <p className={`text-lg font-bold ${jobStatus.status === 'failed' ? 'text-brand-red' : 'text-brand-blue'}`}>{jobStatus.status.toUpperCase()}</p>
                        <p className="text-sm text-slate-600">{String(jobStatus.progress || '')}</p>
                      </>
                    ) : (
                      <p className="text-slate-500">No active job found.</p>
                    )}
                    {isJobActive && (
                      <button
                        onClick={handleStopJob}
                        className="mt-4 bg-brand-red text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center mx-auto hover:opacity-90"
                      >
                        <StopCircle className="w-5 h-5 mr-2" /> Stop Job
                      </button>
                    )}
                  </div>
                </div>

                {jobStatus && jobStatus.logs && (
                  <div className="p-4 border rounded-lg bg-gray-800 text-white font-mono text-xs">
                      <h3 className="font-sans font-semibold text-slate-300 flex items-center mb-2"><ListVideo className="w-5 h-5 mr-2 text-slate-400"/>Portal Status Log</h3>
                      <div className="p-2 bg-black rounded max-h-40 overflow-y-auto" dangerouslySetInnerHTML={{ __html: jobStatus.logs }}>
                      </div>
                  </div>
                )}

                <fieldset disabled={isJobActive} className="space-y-8 disabled:opacity-60">
                  <div>
                    <label className="font-medium text-slate-700 block mb-1">Select a Display</label>
                    <div className="relative"><ListVideo className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"/><select value={selectedDisplay} onChange={(e) => handleSelectDisplay(e.target.value, portalUser, portalPass)} className="w-full pl-10 p-3 border border-slate-300 rounded-lg appearance-none bg-white disabled:cursor-not-allowed">{displayOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.text}</option>)}</select></div>
                  </div>

                  <div className="p-4 border rounded-lg bg-slate-50">
                    <h3 className="font-semibold text-slate-700 flex items-center"><ImageIcon className="w-5 h-5 mr-2 text-slate-500"/>Currently Displaying</h3>
                    <div className="mt-2 h-40 flex items-center justify-center bg-slate-200 rounded">
                        {currentImageUrl ? <img src={currentImageUrl} alt="Current display" className="max-h-full max-w-full object-contain"/> : <p className="text-slate-500 text-sm">No image found.</p>}
                    </div>
                  </div>

                  <div>
                    <h2 className="text-xl font-semibold text-slate-700 flex items-center mb-4">Upload Queue</h2>
                    <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center bg-slate-50"><UploadCloud className="mx-auto h-12 w-12 text-slate-400" /><input type="file" multiple onChange={handleFileChange} id="file-upload" className="hidden" /><label htmlFor="file-upload" className={`mt-2 block text-sm font-medium text-brand-blue ${isJobActive ? 'cursor-not-allowed' : 'cursor-pointer'}`}>Click to browse</label></div>
                    <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
                      {images && images.map((item, index) => {
                        if (!item || !item.file) return null;
                        return (
                          <div key={item.id} draggable={!isJobActive} onDragStart={() => (dragItem.current = index)} onDragEnter={() => (dragOverItem.current = index)} onDragEnd={handleDragSort} onDragOver={(e) => e.preventDefault()} className={`flex items-center p-2 bg-white border rounded-lg shadow-sm ${!isJobActive ? 'cursor-grab' : 'cursor-not-allowed'}`}>
                            <GripVertical className="w-5 h-5 text-slate-400 mr-2" />
                            <img src={item.preview} alt="preview" className="w-12 h-12 rounded-md object-cover mr-4" />
                            <span className="flex-grow text-sm font-medium text-slate-700 truncate">{item.file.name}</span>
                            <button onClick={() => setEditingImage(item)} className="p-1 text-slate-400 hover:text-brand-blue rounded-full mr-2" disabled={isJobActive}>
                              <Crop className="w-5 h-5" />
                            </button>
                            <button onClick={() => removeImage(item.id)} className="p-1 text-slate-400 hover:text-brand-red rounded-full" disabled={isJobActive}>
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <h2 className="text-xl font-semibold text-slate-700 flex items-center mb-4">Set Upload Interval</h2>
                    <div className="flex items-center space-x-4">
                      <Clock className="w-6 h-6 text-slate-500" />
                      <input type="range" min="0" max="60" step="5" value={uploadInterval} onChange={(e) => setUploadInterval(e.target.value)} className="w-full h-2 bg-slate-200 rounded-lg disabled:cursor-not-allowed" />
                      <span className="font-bold text-brand-blue text-lg w-28 text-center">{`${uploadInterval} minutes`}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-center">
                    <input type="checkbox" id="cycle" checked={cycle} onChange={(e) => setCycle(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-brand-blue focus:ring-brand-blue disabled:cursor-not-allowed"/>
                    <label htmlFor="cycle" className="ml-2 block text-sm text-gray-900">Cycle images (loop indefinitely)</label>
                  </div>

                  <button onClick={handleStartAutomation} disabled={status === 'processing' || isJobActive} className="w-full mt-8 bg-brand-green text-white font-bold py-4 px-4 rounded-lg flex items-center justify-center hover:opacity-90 disabled:bg-slate-400 disabled:cursor-not-allowed">
                    <span className="flex items-center justify-center">
                      {status === 'processing' ? 'Submitting...' : 'Create & Start New Job'} <PlayCircle className="ml-2"/>
                    </span>
                  </button>
                </fieldset>
                
                {message && (<p className={`text-center mt-4 text-sm font-medium ${status === 'error' ? 'text-brand-red' : 'text-green-600'}`}>{message}</p>)}
              </>
            )}
            
            {activeTab === 'widgets' && (
              <WidgetsDashboard />
            )}
            
            {activeTab === 'integrations' && (
              <IntegrationsDashboard dashboardUser={dashboardUser} />
            )}
            
          </div>
        </>
      );
    }
  }

  return (
    <div className="bg-slate-100 min-h-screen font-sans flex items-center justify-center p-4">
      <ErrorBoundary>
        {renderContent()}
      </ErrorBoundary>
    </div>
  );
}
