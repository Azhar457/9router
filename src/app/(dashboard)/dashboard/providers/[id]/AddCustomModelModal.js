"use client";

import { useState, useRef } from "react";
import PropTypes from "prop-types";
import { Button, Modal, Select, Toggle } from "@/shared/components";
import { CAPACITY_META, STT_TRANSPORT_META, STT_TRANSPORTS } from "@/shared/constants/models";

const defaultCaps = () => Object.fromEntries(Object.keys(CAPACITY_META).map((key) => [key, false]));

export default function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias, onSave, onClose }) {
  // Reset the form on every open WITHOUT an effect (avoids the
  // react-hooks/set-state-in-effect cascade-render warning). The stateful
  // form lives in AddCustomModelForm below; we give it a `session` key that
  // bumps on each false→true transition of isOpen. A fresh key remounts the
  // form subtree with clean useState values — no setState in an effect.
  //
  // The transition is detected during render using the "adjust state when a
  // prop changes" pattern: a previous-open useState + a same-component
  // setState, which React resolves before commit without a cascade.
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen);
  }
  const [session, setSession] = useState(0);
  if (isOpen && !prevOpen) {
    // Closing transition was recorded in prevOpen on the last render; only
    // bump on a genuine false→true open.
    setSession((s) => s + 1);
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Custom Model">
      {isOpen && (
        <AddCustomModelForm
          key={session}
          providerAlias={providerAlias}
          providerDisplayAlias={providerDisplayAlias}
          onSave={onSave}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

// Owns the form state. Remounted (via key) on every open, so it always
// starts from its fresh useState defaults — no reset effect needed.
function AddCustomModelForm({ providerAlias, providerDisplayAlias, onSave, onClose }) {
  const [modelId, setModelId] = useState("");
  const [caps, setCaps] = useState(defaultCaps);
  const [testStatus, setTestStatus] = useState(null); // null | "testing" | "ok" | "error"
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  // Realtime dispatch marker for the transport select; "" = provider default REST.
  const [transport, setTransport] = useState("");

  // Strip provider's own alias prefix (e.g. "cc/model" -> "model" for cc provider)
  const stripAlias = (id) => {
    const prefix = `${providerAlias}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  };

  const handleTest = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${cleanId}` }),
      });
      const data = await res.json();
      setTestStatus(data.ok ? "ok" : "error");
      setTestError(data.error || "");
    } catch (err) {
      setTestStatus("error");
      setTestError(err.message);
    }
  };

  const handleSave = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId || saving) return;
    setSaving(true);
    try {
      // caps.stt is UI-only; the parent save flow derives the model type from
      // it and forwards the pinned transport (null unless the caller picked one).
      await onSave(cleanId, caps, caps.stt ? transport : null);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleTest();
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="text-sm font-medium mb-1.5 block">Model ID</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={modelId}
            onChange={(e) => { setModelId(e.target.value); setTestStatus(null); setTestError(""); }}
            onKeyDown={handleKeyDown}
            placeholder="e.g. claude-opus-4-5"
            className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            autoFocus
          />
          <Button
            variant="secondary"
            icon="science"
            loading={testStatus === "testing"}
            onClick={handleTest}
            disabled={!modelId.trim() || testStatus === "testing"}
          >
            {testStatus === "testing" ? "Testing..." : "Test"}
          </Button>
        </div>
        <p className="text-xs text-text-muted mt-1">
          Sent to provider as: <code className="font-mono bg-sidebar px-1 rounded">{stripAlias(modelId.trim()) || "model-id"}</code>
        </p>
      </div>

      <div>
        <label className="text-sm font-medium mb-1.5 block">Capabilities</label>
        <div className="flex flex-wrap gap-4">
          {Object.entries(CAPACITY_META).map(([key, meta]) => (
            <Toggle
              key={key}
              checked={!!caps[key]}
              onChange={(v) => setCaps((prev) => ({ ...prev, [key]: v }))}
              label={meta.label}
              description={meta.desc}
              size="sm"
            />
          ))}
        </div>
      </div>

      {/* STT is a model TYPE, not a chat capability: the save flow turns this
          flag into type "stt" (the API honours a transport only on stt
          records). The select pins the realtime dispatch marker persisted
          with the model; the whitelist is the shared STT_TRANSPORT_META. */}
      <div>
        <Toggle
          checked={!!caps.stt}
          onChange={(v) => { setCaps((prev) => ({ ...prev, stt: v })); if (!v) setTransport(""); }}
          label="Speech to text"
          description="Transcribes audio via /v1/audio/transcriptions"
          size="sm"
        />
        {caps.stt && (
          <div className="mt-3">
            <Select
              label="Transport"
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
              placeholder="Provider default (REST)"
              options={STT_TRANSPORTS.map((t) => ({ value: t, label: STT_TRANSPORT_META[t].label }))}
              hint="Realtime transport marker for the STT dispatcher. Empty keeps the provider's REST format."
            />
          </div>
        )}
      </div>

      {/* Test result */}
      {testStatus === "ok" && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <span className="material-symbols-outlined text-base">check_circle</span>
          Model is reachable
        </div>
      )}
      {testStatus === "error" && (
        <div className="flex items-start gap-2 text-sm text-red-500">
          <span className="material-symbols-outlined text-base shrink-0">cancel</span>
          <span>{testError || "Model not reachable"}</span>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
        <Button
          onClick={handleSave}
          fullWidth
          size="sm"
          disabled={!modelId.trim() || saving}
        >
          {saving ? "Adding..." : "Add Model"}
        </Button>
      </div>
    </div>
  );
}

AddCustomModelForm.propTypes = {
  providerAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
