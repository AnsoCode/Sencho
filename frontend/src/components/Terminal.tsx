import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';

interface TerminalComponentProps {
  stackName?: string;
}

export default function TerminalComponent({ stackName }: TerminalComponentProps) {
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
          allowProposedApi: true,
          theme: {
            background: '#0d1117',
            foreground: '#e6edf3',
            cursor: '#58a6ff',
            black: '#484f58',
            red: '#ff7b72',
            green: '#3fb950',
            yellow: '#d29922',
            blue: '#58a6ff',
            magenta: '#bc8cff',
            cyan: '#39c5cf',
            white: '#b1bac4',
            brightBlack: '#6e7681',
            brightRed: '#ffa198',
            brightGreen: '#56d364',
            brightYellow: '#e3b341',
            brightBlue: '#79c0ff',
            brightMagenta: '#d2a8ff',
            brightCyan: '#56d4dd',
            brightWhite: '#ffffff',
          },
          fontFamily: "'JetBrains Mono', Consolas, Monaco, monospace",
          fontSize: 13,
          scrollback: 10000,
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

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const cleanStackName = stackName?.replace(/\.(yml|yaml)$/, '');

        // If a stackName is provided, connect to the dedicated logs WebSocket
        // Otherwise, fall back to the generic terminal WebSocket
        const wsUrl = cleanStackName
          ? `${wsProtocol}//${window.location.host}/api/stacks/${cleanStackName}/logs`
          : `${wsProtocol}//${window.location.host}`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (mounted) {
            if (!cleanStackName) {
              // Generic terminal mode - send connect action
              ws.send(JSON.stringify({ action: 'connectTerminal' }));
            }
            // For stack logs mode, the server starts streaming automatically on connection
          }
        };

        ws.onmessage = (event) => {
          if (mounted && terminalInstance.current) {
            const text = typeof event.data === 'string' ? event.data : event.data.toString();
            terminalInstance.current.write(text.replace(/\r?\n/g, '\r\n'));
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
    let resizeTimeout: number | undefined;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current && mounted) {
          try {
            fitAddonRef.current.fit();
          } catch {
            // Ignore fit errors during resize
          }
        }
      }, 50);
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
  }, [stackName]);

  return <div ref={terminalRef} className="h-full w-full" />;
}