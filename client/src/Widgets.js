import React, { useState } from 'react';
import { TramFront, Loader2 } from 'lucide-react'; // Using lucide-react icons for consistency

const SubwayWidget = () => {
    const [trainData, setTrainData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const fetchTrainData = () => {
        setIsLoading(true);
        setError('');
        setTrainData(null);

        // This is a placeholder for a real API call.
        // We will replace this with a real data source later.
        setTimeout(() => {
            // Simulating a successful API response
            setTrainData([
                { line: 'A', direction: 'Uptown', arrival: '2 min' },
                { line: 'C', direction: 'Uptown', arrival: '5 min' },
                { line: 'E', direction: 'Downtown', arrival: '8 min' },
                { line: 'A', direction: 'Downtown', arrival: '12 min' },
            ]);
            setIsLoading(false);
        }, 1500);
    };

    return (
        <div className="p-6 border rounded-xl bg-slate-50 shadow-sm">
            <div className="flex justify-between items-center">
                <h3 className="font-semibold text-slate-800 flex items-center">
                    <TramFront className="w-6 h-6 mr-3 text-slate-500"/>
                    Real-Time Subway Arrivals
                </h3>
                <button 
                    onClick={fetchTrainData} 
                    disabled={isLoading} 
                    className="bg-brand-blue text-white font-bold py-2 px-4 rounded-lg hover:opacity-90 disabled:bg-slate-400 flex items-center"
                >
                    {isLoading ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Fetching...</> : 'Get Times'}
                </button>
            </div>

            {error && <p className="mt-4 text-center text-red-600">{error}</p>}

            {trainData && (
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b-2 border-slate-200">
                                <th className="p-3 text-sm font-semibold text-slate-600">Line</th>
                                <th className="p-3 text-sm font-semibold text-slate-600">Direction</th>
                                <th className="p-3 text-sm font-semibold text-slate-600">Next Arrival</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trainData.map((train, index) => (
                                <tr key={index} className="border-b border-slate-100 hover:bg-slate-100">
                                    <td className="p-3 font-mono font-bold">{train.line}</td>
                                    <td className="p-3 text-slate-700">{train.direction}</td>
                                    <td className="p-3 text-slate-700 font-medium">{train.arrival}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default function WidgetsDashboard() {
    return (
        <div className="space-y-8">
            <SubwayWidget />
            {/* We can add more widgets here in the future */}
        </div>
    );
} 