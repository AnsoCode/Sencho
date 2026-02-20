import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Terminal as TerminalIcon, X } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface BashExecModalProps {
  isOpen: boolean;
  onClose: () => void;
  containerId: string;
  containerName: string;
}

export default function BashExecModal({ isOpen, onClose, containerId, containerName }: BashExecModalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (isOpen && terminalRef.current && !xtermRef.current) {
      // Initialize xterm.js
      const term = new Terminal({
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#ffffff',
          cursorAccent: '#000000',
          selectionBackground: 'rgba(255, 255, 255, 0.3)',
        },
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: 14,
        cursorBlink: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      
      setTimeout(() => {
        fitAddon.fit();
      }, 100);

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Connect to WebSocket for bash exec
      const ws = new WebSocket('ws://localhost:3000');
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          action: 'execContainer',
          containerId: containerId,
        }));
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'output') {
            term.write(data.data);
          } else if (data.type === 'error') {
            term.write(`\r\n\x1b[31mError: ${data.message}\x1b[0m\r\n`);
          } else if (data.type === 'exit') {
            term.write('\r\n\x1b[33mSession ended\x1b[0m\r\n');
            setIsConnected(false);
          }
        } catch {
          // Raw output
          term.write(event.data);
        }
      };

      ws.onerror = () => {
        term.write('\r\n\x1b[31mConnection error\x1b[0m\r\n');
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
      };

      // Handle user input
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            action: 'input',
            data: data,
          }));
        }
      });

      // Handle resize
      const handleResize = () => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              action: 'resize',
              cols: term.cols,
              rows: term.rows,
            }));
          }
        }
      };

      window.addEventListener('resize', handleResize);
      
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }

    return () => {
      // Cleanup on close
      if (!isOpen) {
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        if (xtermRef.current) {
          xtermRef.current.dispose();
          xtermRef.current = null;
        }
        if (fitAddonRef.current) {
          fitAddonRef.current = null;
        }
        setIsConnected(false);
      }
    };
  }, [isOpen, containerId]);

  const handleClose = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    setIsConnected(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl h-[600px] flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle className="flex items-center gap-2">
            <TerminalIcon className="w-5 h-5" />
            Bash: {containerName}
            {isConnected && (
              <span className="ml-2 text-xs bg-green-500/20 text-green-500 px-2 py-0.5 rounded-full">
                Connected
              </span>
            )}
          </DialogTitle>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            <X className="w-4 h-4" />
          </Button>
        </DialogHeader>
        <div 
          ref={terminalRef} 
          className="flex-1 rounded-lg overflow-hidden bg-[#1e1e1e] p-2"
          style={{ minHeight: '500px' }}
        />
      </DialogContent>
    </Dialog>
  );
}
