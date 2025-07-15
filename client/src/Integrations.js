import React from 'react';

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


const SlackIntegrationCard = () => {
    // This now points to our backend OAuth endpoint
    const handleConnectClick = () => {
        window.location.href = `${API_URL}/api/slack/oauth/start`;
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
                    className="bg-[#4A154B] text-white font-bold py-2 px-4 rounded-lg hover:opacity-90 flex items-center"
                >
                    Add to Slack
                </button>
            </div>
            <p className="mt-4 text-sm text-slate-600">
                Connect your account to enable uploading images directly from a Slack channel. You will be redirected to Slack to authorize the application.
            </p>
        </div>
    );
};


export default function IntegrationsDashboard() {
    return (
        <div className="space-y-8">
            <SlackIntegrationCard />
            {/* We can add more integrations here in the future */}
        </div>
    );
} 