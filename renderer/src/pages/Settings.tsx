import React, { useContext } from 'react';
import { ThemeContext } from '../App';

export default function Settings() {
  const { dark, toggle } = useContext(ThemeContext);
  const [autoDiscover, setAutoDiscover] = React.useState(true);
  const [notifications, setNotifications] = React.useState(true);

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      <div className="settings-section">
        <h3>Appearance</h3>
        <div className="card">
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Dark mode</div>
              <div className="settings-row-desc">Switch to a dark color scheme</div>
            </div>
            <button
              className={`toggle ${dark ? 'active' : ''}`}
              onClick={toggle}
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Cluster</h3>
        <div className="card">
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Auto-discover nodes</div>
              <div className="settings-row-desc">Automatically find Title TBD nodes on your network</div>
            </div>
            <button
              className={`toggle ${autoDiscover ? 'active' : ''}`}
              onClick={() => setAutoDiscover(!autoDiscover)}
            />
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Notifications</div>
              <div className="settings-row-desc">Show alerts when nodes join, leave, or go offline</div>
            </div>
            <button
              className={`toggle ${notifications ? 'active' : ''}`}
              onClick={() => setNotifications(!notifications)}
            />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>About</h3>
        <div className="card">
          <div className="settings-row">
            <div className="settings-row-label">Version</div>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>0.2.0</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">Node ID</div>
            <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>a3f8b2c1...</span>
          </div>
          <div className="settings-row">
            <div className="settings-row-label">Role</div>
            <span className="node-role-badge coordinator">Coordinator</span>
          </div>
        </div>
      </div>
    </div>
  );
}
