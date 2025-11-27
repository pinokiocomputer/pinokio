/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    startPinokio: () => Promise<{ started: boolean; port?: number }>;
    send: (type: string, msg: any) => void;
    startInspector: (payload?: any) => Promise<any>;
    stopInspector: () => Promise<any>;
    captureScreenshot: (screenshotRequest: any) => Promise<any>;
  };
}
