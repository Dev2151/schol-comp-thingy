import React, { useState, useRef } from 'react';

interface StoredFile {
  fileId: string;
  filename: string;
  size: number;
  uploadedAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

interface FilesProps {
  relayUrl: string;
  nodeId: string;
}

export default function Files({ relayUrl, nodeId }: FilesProps) {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPendingFile(file);
      setShowPassword(true);
    }
  };

  const handleUpload = async () => {
    if (!pendingFile || !password || !relayUrl) return;

    setUploading(true);
    setProgress('Reading file...');

    try {
      // Read file as array buffer
      const arrayBuffer = await pendingFile.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      // In a real implementation, we'd encrypt and split here
      // For now, send the raw file to the relay
      setProgress('Uploading to network...');

      const chunkId = crypto.randomUUID();
      const response = await fetch(`${relayUrl}/chunk/${chunkId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: btoa(String.fromCharCode(...data)),
          metadata: {
            filename: pendingFile.name,
            size: pendingFile.size,
            type: pendingFile.type,
            uploadedBy: nodeId,
          },
          nodeId,
        }),
      });

      if (response.ok) {
        setProgress('Uploaded!');
        setFiles(prev => [
          ...prev,
          {
            fileId: chunkId,
            filename: pendingFile.name,
            size: pendingFile.size,
            uploadedAt: new Date().toISOString(),
          },
        ]);
        setTimeout(() => {
          setUploading(false);
          setProgress('');
          setShowPassword(false);
          setPassword('');
          setPendingFile(null);
        }, 1500);
      } else {
        setProgress('Upload failed');
      }
    } catch (err: any) {
      setProgress(`Error: ${err.message}`);
    }
  };

  const handleDownload = async (file: StoredFile) => {
    if (!relayUrl) return;

    setProgress('Downloading...');

    try {
      const response = await fetch(`${relayUrl}/chunk/${file.fileId}`);
      if (response.ok) {
        const result = await response.json() as any;
        const binaryData = atob(result.data);
        const bytes = new Uint8Array(binaryData.length);
        for (let i = 0; i < binaryData.length; i++) {
          bytes[i] = binaryData.charCodeAt(i);
        }

        // Create blob and download
        const blob = new Blob([bytes]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setProgress('Downloaded!');
        setTimeout(() => setProgress(''), 1500);
      }
    } catch (err: any) {
      setProgress(`Error: ${err.message}`);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>Files</h2>
        <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()}>
          + Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
      </div>

      {progress && (
        <div className="progress-banner">
          {progress}
        </div>
      )}

      {showPassword && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Encryption Password</h3>
            <p>Set a password to encrypt this file.</p>
            <input
              type="password"
              placeholder="Password..."
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="input"
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowPassword(false); setPendingFile(null); }}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleUpload} disabled={!password}>
                Upload
              </button>
            </div>
          </div>
        </div>
      )}

      {files.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📁</div>
          <h3>No files yet</h3>
          <p>Upload a file to the distributed network</p>
        </div>
      ) : (
        <div className="file-list">
          {files.map(file => (
            <div key={file.fileId} className="file-card">
              <div className="file-info">
                <span className="file-name">{file.filename}</span>
                <span className="file-meta">{formatBytes(file.size)}</span>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => handleDownload(file)}>
                ↓
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
