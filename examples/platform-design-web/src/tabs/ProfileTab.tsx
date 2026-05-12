import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
export function ProfileTab() {
    return (<>
      <div className="card">
        <h2>Profile</h2>
        <div className="list-row">
          <span className="material-icons">badge</span>
          <div className="grow">
            <div className="title">User</div>
            <div className="subtitle">Nimish GJ · nimish@base14.io</div>
          </div>
        </div>
        <div className="list-row">
          <span className="material-icons">workspace_premium</span>
          <div className="grow">
            <div className="title">Plan</div>
            <div className="subtitle">Pro</div>
          </div>
        </div>
      </div>

      <DiagnosticsPanel />
    </>);
}
