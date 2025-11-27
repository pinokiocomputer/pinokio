import { useState, useEffect } from 'react';

function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [port, setPort] = useState<number | null>(null);
  const [counter, setCounter] = useState<number | null>(null);

  const fetchCounter = async (currentPort: number) => {
    try {
      const response = await fetch(`http://localhost:${currentPort}/counter`);
      const data = await response.json();
      setCounter(data.counter);
    } catch (e) {
      console.error("Failed to fetch counter", e);
    }
  };

  const updateCounter = async (action: 'increment' | 'decrement') => {
    if (!port) return;
    try {
      const response = await fetch(`http://localhost:${port}/counter/${action}`, {
        method: 'POST'
      });
      const data = await response.json();
      setCounter(data.counter);
    } catch (e) {
      console.error(`Failed to ${action} counter`, e);
    }
  };

  const start = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await window.electronAPI.startPinokio();
      if (!res || res.started !== true) {
        setError('Pinokio failed to start or is already running.');
        setLoading(false);
      } else {
        setLoading(false);
        if (res.port) {
          setPort(res.port);
          fetchCounter(res.port);
        }
      }
    } catch (err: any) {
      setError(err && err.message ? err.message : String(err));
      setLoading(false);
    }
  };

  const openDashboard = () => {
    if (port) {
      window.location.href = `http://localhost:${port}`;
    }
  };

  if (port) {
    return (
      <div className="card">
        <div className="title">Pinokio Running</div>
        <div className="subtitle">Port: {port}</div>
        
        <div className="counter-container" style={{ margin: '20px 0', padding: '20px', border: '1px solid #eee', borderRadius: '8px', width: '100%' }}>
          <div className="subtitle" style={{ marginBottom: '10px' }}>Counter API Demo</div>
          <div style={{ fontSize: '32px', fontWeight: 'bold', margin: '10px 0' }}>
            {counter !== null ? counter : '...'}
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button className="btn" onClick={() => updateCounter('decrement')}>-</button>
            <button className="btn" onClick={() => updateCounter('increment')}>+</button>
          </div>
        </div>

        <button className="btn" onClick={openDashboard}>
          Open Pinokio Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="title">Pinokio</div>
      <div className="subtitle">Click to start the server</div>
      {error && <div className="error">{error}</div>}
      <button className="btn" disabled={loading} onClick={start}>
        {loading ? 'Starting…' : 'Start Pinokio'}
      </button>
    </div>
  );
}

export default App;
