import { useState } from 'react';

function App() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
          window.location.href = `http://localhost:${res.port}`;
        }
      }
    } catch (err: any) {
      setError(err && err.message ? err.message : String(err));
      setLoading(false);
    }
  };

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
