import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as TerminalIcon, X } from 'lucide-react';
import { Button } from './ui/button';
import '@xterm/xterm/css/xterm.css';
import { useNodes } from '@/context/NodeContext';

interface HostConsoleProps {
    stackName?: string | null;
    onClose: () => void;
}

/** Build the xterm theme from CSS custom properties (resolved once per call). */
function getTerminalTheme() {
    const s = getComputedStyle(document.documentElement);
    return {
        background: s.getPropertyValue('--terminal-bg').trim(),
        foreground: s.getPropertyValue('--terminal-fg').trim(),
        cursor: s.getPropertyValue('--terminal-cursor').trim(),
        cursorAccent: s.getPropertyValue('--terminal-cursor-accent').trim(),
        selectionBackground: s.getPropertyValue('--terminal-selection').trim(),
    };
}

export default function HostConsole({ stackName, onClose }: HostConsoleProps) {
    const { activeNode } = useNodes();
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    const cleanup = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        if (xtermRef.current) {
            xtermRef.current.dispose();
            xtermRef.current = null;
        }
        fitAddonRef.current = null;
        setIsConnected(false);
    }, []);

    useEffect(() => {
        const container = terminalRef.current;
        if (!container) return;

        let mounted = true;

        const term = new Terminal({
            theme: getTerminalTheme(),
            fontFamily: "'Geist Mono', monospace",
            fontSize: 14,
            cursorBlink: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(container);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        requestAnimationFrame(() => {
            try {
                if (mounted) fitAddon.fit();
            } catch {
                // Ignore fit errors during initial render
            }
        });

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const activeNodeId = localStorage.getItem('sencho-active-node') || '';
        const nodeParam = activeNodeId ? `nodeId=${activeNodeId}` : '';
        const stackParam = stackName ? `stack=${encodeURIComponent(stackName)}` : '';
        const queryString = [nodeParam, stackParam].filter(Boolean).join('&');
        const wsUrl = `${wsProtocol}//${window.location.host}/api/system/host-console${queryString ? `?${queryString}` : ''}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            if (!mounted) return;
            setIsConnected(true);
            term.focus();

            setTimeout(() => {
                try {
                    if (mounted) fitAddon.fit();
                } catch {
                    // Ignore
                }
                if (ws.readyState === WebSocket.OPEN && term.rows > 0 && term.cols > 0) {
                    ws.send(JSON.stringify({
                        type: 'resize',
                        cols: term.cols,
                        rows: term.rows,
                    }));
                }
            }, 100);
        };

        ws.onmessage = (event) => {
            if (!mounted) return;
            const text = typeof event.data === 'string' ? event.data : event.data.toString();
            term.write(text);
        };

        ws.onerror = () => {
            if (!mounted) return;
            term.write('\r\n\x1b[31mConnection error\x1b[0m\r\n');
            setIsConnected(false);
        };

        ws.onclose = () => {
            if (!mounted) return;
            term.write('\r\n\x1b[33mSession ended\x1b[0m\r\n');
            setIsConnected(false);
        };

        term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'input',
                    payload: data,
                }));
            }
        });

        let resizeTimeout: ReturnType<typeof setTimeout>;
        const resizeObserver = new ResizeObserver(() => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (!mounted || !fitAddonRef.current || !wsRef.current) return;
                try {
                    fitAddonRef.current.fit();
                } catch {
                    return;
                }
                if (wsRef.current.readyState === WebSocket.OPEN && term.rows > 0 && term.cols > 0) {
                    wsRef.current.send(JSON.stringify({
                        type: 'resize',
                        cols: term.cols,
                        rows: term.rows,
                    }));
                }
            }, 50);
        });

        resizeObserver.observe(container);

        return () => {
            mounted = false;
            resizeObserver.disconnect();
            clearTimeout(resizeTimeout);
            cleanup();
        };
    }, [stackName, cleanup]);

    return (
        <div className="flex flex-col h-full w-full rounded-lg border border-card-border border-t-card-border-top bg-card text-card-foreground shadow-card-bevel overflow-hidden transition-colors hover:border-t-card-border-hover">
            <div className="flex items-center justify-between px-4 py-2 border-b border-card-border bg-muted/40 shrink-0">
                <div className="flex items-center gap-2 font-medium">
                    <TerminalIcon className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                    <span>Host Console</span>
                    {activeNode && (
                        <span className="text-muted-foreground font-normal text-sm">
                            - {activeNode.name}
                        </span>
                    )}
                    {stackName && (
                        <span className="text-muted-foreground font-normal text-sm">
                            ({stackName})
                        </span>
                    )}
                    {isConnected && (
                        <span className="ml-2 text-xs bg-success-muted text-success px-2 py-0.5 rounded-full border border-success/20">
                            Connected
                        </span>
                    )}
                </div>
                <Button variant="ghost" size="sm" onClick={onClose} className="h-8 gap-1.5 text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" strokeWidth={1.5} />
                    Close Console
                </Button>
            </div>
            <div
                className="flex-1 p-2 min-h-0 relative shadow-[inset_0_2px_4px_0_oklch(0_0_0/0.4)]"
                style={{ backgroundColor: 'var(--terminal-bg)', overflow: 'hidden' }}
            >
                <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
            </div>
        </div>
    );
}
