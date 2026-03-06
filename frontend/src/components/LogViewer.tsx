import { useEffect, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Terminal } from "lucide-react";

interface LogViewerProps {
    containerId: string | null;
    containerName: string;
    isOpen: boolean;
    onClose: () => void;
}

export function LogViewer({ containerId, containerName, isOpen, onClose }: LogViewerProps) {
    const [logs, setLogs] = useState<string[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new logs arrive
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        if (!isOpen || !containerId) return;

        setLogs([]);
        setIsConnected(false);

        const eventSource = new EventSource(`/api/containers/${containerId}/logs`);

        eventSource.onopen = () => setIsConnected(true);

        eventSource.onmessage = (event) => {
            try {
                const newLog = JSON.parse(event.data);
                setLogs(prev => {
                    const updated = [...prev, newLog];
                    return updated.length > 1000 ? updated.slice(updated.length - 1000) : updated;
                });
            } catch (err) {
                console.error("Failed to parse log line", err);
            }
        };

        eventSource.onerror = () => {
            setIsConnected(false);
            eventSource.close();
        };

        return () => {
            eventSource.close();
        };
    }, [isOpen, containerId]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col bg-background border-border">
                <DialogHeader className="flex flex-row items-center gap-2 pb-2 border-b">
                    <Terminal className="w-5 h-5" />
                    <DialogTitle className="flex-1 text-left font-mono text-sm">
                        {containerName} {isConnected ? <span className="text-green-500 text-xs ml-2">(connected)</span> : <Loader2 className="inline w-3 h-3 ml-2 animate-spin" />}
                    </DialogTitle>
                </DialogHeader>

                <div
                    ref={scrollRef}
                    className="flex-1 w-full bg-[#0c0c0c] text-green-400 p-4 rounded-md overflow-y-auto font-mono text-xs mt-2"
                >
                    {logs.length === 0 && !isConnected ? (
                        <div className="text-muted-foreground">Connecting to container stream...</div>
                    ) : (
                        logs.map((log, i) => (
                            <div key={i} className="break-all whitespace-pre-wrap leading-tight mb-1">
                                {log}
                            </div>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
