import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const PROJECT = "dm-cc-connector-1";

function App() {
  const [method, setMethod] = useState("Config Connector");
  const [bucketName, setBucketName] = useState("");
  const [region, setRegion] = useState("asia-south1");
  const [resources, setResources] = useState([]);
  const [errors, setErrors] = useState([]);
  const [activity, setActivity] = useState("Ready.");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch(`/api/resources?project=${encodeURIComponent(PROJECT)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not retrieve resources.");
      setResources(data.resources || []);
      setErrors(data.errors || []);
      setActivity(`Refreshed at ${new Date().toLocaleTimeString()}.`);
    } catch (e) {
      setActivity(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function createResource(e) {
    e.preventDefault();
    if (!bucketName.trim()) {
      setActivity("Enter a bucket name.");
      return;
    }

    setBusy(true);
    setActivity(`Creating ${method} resource...`);
    try {
      const response = await fetch("/api/resources/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          bucketName: bucketName.trim(),
          region,
          project: PROJECT
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Creation failed.");
      setActivity(`${data.method} creation succeeded.\n\n${data.output || ""}`);
      setBucketName("");
      await refresh();
    } catch (e) {
      setActivity(`Creation failed:\n${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteResource(resource) {
    const message = `Delete ${resource.method} resource "${resource.name}"?\n\nThis is a real cloud operation.`;
    if (!window.confirm(message)) return;

    setBusy(true);
    setActivity(`Deleting ${resource.name}...`);
    try {
      const response = await fetch("/api/resources/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: resource.method,
          name: resource.name,
          namespace: resource.namespace || "default",
          project: PROJECT
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Deletion failed.");
      setActivity(`Deletion succeeded.\n\n${data.output || ""}`);
      await refresh();
    } catch (e) {
      setActivity(`Deletion failed:\n${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <div className="eyebrow">GOOGLE CLOUD INFRASTRUCTURE</div>
          <h1>Cloud Resource Manager</h1>
          <p>Create and manage real Cloud Storage resources through Deployment Manager or Config Connector.</p>
        </div>
        <div className="project">
          <span>Project</span>
          <strong>{PROJECT}</strong>
        </div>
      </header>

      <main className="grid">
        <section className="card create-card">
          <h2>Create Resource</h2>
          <p className="muted">Choose a management method and create a real Cloud Storage resource.</p>

          <form onSubmit={createResource}>
            <label>Management Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}>
              <option>Config Connector</option>
              <option>Deployment Manager</option>
            </select>

            <label>Bucket Name</label>
            <input
              value={bucketName}
              onChange={e => setBucketName(e.target.value.toLowerCase())}
              placeholder="my-demo-bucket-2026"
            />

            <label>Region</label>
            <select value={region} onChange={e => setRegion(e.target.value)}>
              <option value="asia-south1">ASIA-SOUTH1</option>
              <option value="us-central1">US-CENTRAL1</option>
              <option value="europe-west1">EUROPE-WEST1</option>
              <option value="asia-east1">ASIA-EAST1</option>
            </select>

            <button className="primary" disabled={busy}>
              {busy ? "Working..." : "Create Resource"}
            </button>
          </form>
        </section>

        <section className="card resources-card">
          <div className="section-head">
            <div>
              <h2>Resources</h2>
              <p className="muted">Live resources retrieved from Google Cloud and Kubernetes.</p>
            </div>
            <button className="secondary" onClick={refresh} disabled={busy}>↻ Refresh</button>
          </div>

          {errors.length > 0 && (
            <div className="warning">
              {errors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {resources.length === 0 ? (
            <div className="empty">No resources returned yet.</div>
          ) : (
            <div className="resource-list">
              {resources.map((r, i) => (
                <div className="resource" key={`${r.method}-${r.name}-${i}`}>
                  <div className="resource-main">
                    <div className="resource-title">{r.name}</div>
                    <div className="resource-meta">{r.method} · {r.type}</div>
                    <div className="resource-detail">{r.bucket || r.detail}</div>
                  </div>
                  <div className="resource-side">
                    <span className="status">{r.status}</span>
                    <button className="danger" onClick={() => deleteResource(r)} disabled={busy}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card activity-card">
          <h2>Activity / Command Output</h2>
          <pre>{activity}</pre>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
