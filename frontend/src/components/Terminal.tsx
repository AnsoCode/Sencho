import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';

export default function TerminalComponent() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!terminalRef.current) {
      console.error('Terminal ref not ready');
      return;
    }

    // Clean up any existing terminal
    if (terminalInstance.current) {
      try {
        terminalInstance.current.dispose();
      } catch {
        // Ignore dispose errors
      }
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore close errors
      }
    }

    let mounted = true;

    const initTerminal = () => {
      if (!mounted || !terminalRef.current) return;

      try {
        const term = new Terminal({
          cursorBlink: true,
          convertEol: true,
          theme: {
            background: '#000000',
            foreground: '#ffffff',
            cursor: '#ffffff',
          },
          fontFamily: 'Consolas, Monaco, monospace',
          fontSize: 13,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        fitAddonRef.current = fitAddon;

        term.open(terminalRef.current);
        terminalInstance.current = term;

        // Fit after DOM paint using requestAnimationFrame
        requestAnimationFrame(() => {
          if (!mounted || !fitAddonRef.current || !terminalRef.current) return;
          try {
            fitAddonRef.current.fit();
          } catch (err) {
            console.error('Error fitting terminal:', err);
          }
        });

        const ws = new WebSocket('ws://localhost:3000');
        wsRef.current = ws;

        ws.onopen = () => {
          if (mounted) {
            ws.send(JSON.stringify({ action: 'connectTerminal' }));
          }
        };

        ws.onmessage = (event) => {
          if (mounted && terminalInstance.current) {
            terminalInstance.current.write(event.data);
          }
        };

        ws.onerror = (err) => {
          console.error('WebSocket error:', err);
        };

      } catch (err) {
        console.error('Error initializing terminal:', err);
      }
    };

    // Initialize terminal after a small delay to ensure container is rendered
    const timeoutId = setTimeout(initTerminal, 50);

    // Attach ResizeObserver to the terminal's parent container
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && terminalRef.current && mounted) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // Ignore fit errors during resize
        }
      }
    });

    if (terminalRef.current.parentElement) {
      resizeObserver.observe(terminalRef.current.parentElement);
    }

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // Ignore close errors
        }
        wsRef.current = null;
      }
      if (terminalInstance.current) {
        try {
          terminalInstance.current.dispose();
        } catch {
          // Ignore dispose errors
        }
        terminalInstance.current = null;
      }
      fitAddonRef.current = null;
    };
  }, []);

  return <div ref={terminalRef} className="h-full w-full" />;
}