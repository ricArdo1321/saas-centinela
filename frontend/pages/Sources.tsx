import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Server, Copy, CheckCircle, Terminal } from 'lucide-react';
import { api } from '../services/api';
import { useToast } from '../components/ToastSystem';

export const Sources: React.FC = () => {
    const [sources, setSources] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [newSourceData, setNewSourceData] = useState({ name: '', type: 'fortigate_syslog' });

    // State for showing the API key modal after creation
    const [createdSource, setCreatedSource] = useState<any>(null);

    const { addToast } = useToast();

    useEffect(() => {
        fetchSources();
    }, []);

    const fetchSources = async () => {
        try {
            const data = await api.getSources();
            setSources(data);
        } catch (err) {
            addToast('Failed to load sources', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const source = await api.createSource(newSourceData);
            setCreatedSource(source); // Show modal with API Key
            setSources([source, ...sources]);
            setIsCreating(false);
            setNewSourceData({ name: '', type: 'fortigate_syslog' });
            addToast('Source created successfully', 'success');
        } catch (err) {
            addToast('Failed to create source', 'error');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this source? Logs will stop being ingested.')) return;
        try {
            await api.deleteSource(id);
            setSources(sources.filter(s => s.id !== id));
            addToast('Source deleted', 'success');
        } catch (err) {
            addToast('Failed to delete source', 'error');
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        addToast('Copied to clipboard', 'success');
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-white">Log Sources</h1>
                    <p className="text-slate-400">Manage your data ingest points (Collectors)</p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition-colors"
                >
                    <Plus size={18} />
                    Add Source
                </button>
            </div>

            {isCreating && (
                <div className="bg-slate-800/50 border border-slate-700 p-6 rounded-xl animate-in fade-in slide-in-from-top-4">
                    <h3 className="text-lg font-semibold text-white mb-4">New Log Source</h3>
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">Source Name</label>
                            <input
                                type="text"
                                required
                                placeholder="e.g. FortiGate Main Office"
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                value={newSourceData.name}
                                onChange={e => setNewSourceData({ ...newSourceData, name: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">Type</label>
                            <select
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white outline-none"
                                value={newSourceData.type}
                                onChange={e => setNewSourceData({ ...newSourceData, type: e.target.value })}
                            >
                                <option value="fortigate_syslog">FortiGate (Syslog)</option>
                            </select>
                        </div>
                        <div className="flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setIsCreating(false)}
                                className="px-4 py-2 text-slate-300 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg"
                            >
                                Create Source
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* API Key Modal */}
            {createdSource && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-in fade-in">
                    <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-6 space-y-6 shadow-2xl">
                        <div className="flex items-start gap-4">
                            <div className="bg-green-500/10 p-3 rounded-full">
                                <CheckCircle className="text-green-500" size={32} />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white">Source Created Successfully!</h2>
                                <p className="text-slate-400">Save this API Key immediately. You won't be able to see it again.</p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-300">API Key (Collector Token)</label>
                            <div className="flex items-center gap-2">
                                <code className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-3 text-green-400 font-mono text-lg truncate">
                                    {createdSource.api_key}
                                </code>
                                <button
                                    onClick={() => copyToClipboard(createdSource.api_key)}
                                    className="p-3 bg-slate-800 hover:bg-slate-700 rounded-lg text-white transition-colors"
                                >
                                    <Copy size={20} />
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-300">Run Collector (Docker)</label>
                            <div className="relative group">
                                <pre className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-slate-300 font-mono text-sm overflow-x-auto whitespace-pre-wrap">
                                    {createdSource.instructions?.docker_command}
                                </pre>
                                <button
                                    onClick={() => copyToClipboard(createdSource.instructions?.docker_command)}
                                    className="absolute top-2 right-2 p-2 bg-slate-800/80 hover:bg-slate-700 rounded text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <Copy size={16} />
                                </button>
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <button
                                onClick={() => setCreatedSource(null)}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium"
                            >
                                I have saved my key
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Sources List */}
            <div className="grid gap-4">
                {isLoading ? (
                    <div className="text-center py-12 text-slate-400">Loading sources...</div>
                ) : sources.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-slate-800 rounded-xl">
                        <div className="bg-slate-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Server className="text-slate-400" size={32} />
                        </div>
                        <h3 className="text-lg font-medium text-white mb-1">No Sources Configured</h3>
                        <p className="text-slate-400 mb-4">Add a log source to start ingesting data.</p>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="text-blue-400 hover:text-blue-300 font-medium"
                        >
                            Add your first source
                        </button>
                    </div>
                ) : (
                    sources.map(source => (
                        <div
                            key={source.id}
                            className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex items-center justify-between hover:bg-slate-800/80 transition-colors"
                        >
                            <div className="flex items-center gap-4">
                                <div className="bg-blue-500/10 p-3 rounded-lg">
                                    <Server className="text-blue-500" size={24} />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-white">{source.name}</h3>
                                    <div className="flex items-center gap-3 text-sm text-slate-400">
                                        <span className="bg-slate-700 px-2 py-0.5 rounded text-xs uppercase">{source.type}</span>
                                        <span>Created {new Date(source.created_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-4">
                                <div className="text-right hidden sm:block">
                                    <div className="text-xs text-slate-500 mb-1">STATUS</div>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${source.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
                                        <span className="text-sm text-white capitalize">{source.status}</span>
                                    </div>
                                </div>
                                <div className="h-8 w-px bg-slate-700 mx-2" />
                                <button
                                    onClick={() => handleDelete(source.id)}
                                    className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                                    title="Delete Source"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
