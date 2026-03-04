"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import hljs from 'highlight.js/lib/core';
import csharp from 'highlight.js/lib/languages/csharp';
hljs.registerLanguage('csharp', csharp);
import { IAMService } from "@tidecloak/js";
import { Models } from "@tide/js";
const Policy = Models.Policy;
const ExecutionType = Models.ExecutionType;
const ApprovalType = Models.ApprovalType;
import { PolicySignRequest } from "heimdall-tide";
import { useAuth } from "@/hooks/useAuth";
import {
    getVendorIdForPolicy,
} from "@/lib/tidecloakApi";
import { bytesToBase64, base64ToBytes } from "@/lib/tideSerialization";
import { contract as defaultForsetiContract, computeContractId } from "@/lib/forsetiContract";

// ─── Types ──────────────────────────────────────────────────────────────────

interface PendingPolicy {
    id: string;
    requestedBy: string;
    data: string;
    commitReady: boolean;
    approvedBy: string[];
    deniedBy: string[];
    modelId?: string;
    contractId?: string;
}

interface CommittedPolicy {
    data: string;
    role: string;
    threshold: number;
    resource: string;
}

// ─── Toggle Component ───────────────────────────────────────────────────────

function Toggle({ checked, onChange, label, children }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    label: string;
    children?: React.ReactNode;
}) {
    return (
        <div className={`toggle-row${checked ? ' active' : ''}`}>
            <label className="toggle-label" onClick={() => onChange(!checked)}>
                <span className={`toggle-track${checked ? ' on' : ''}`} />
                <span className="toggle-text">{label}</span>
            </label>
            {checked && children && (
                <div className="toggle-body">{children}</div>
            )}
        </div>
    );
}

// ─── Policy Tooltip ─────────────────────────────────────────────────────────

function PolicyTooltip({ text }: { text: string }) {
    return (
        <span className="policy-tooltip-wrap">
            <span className="policy-tooltip-icon">i</span>
            <span className="policy-tooltip-bubble">{text}</span>
        </span>
    );
}

// ─── Policy Preview Component ───────────────────────────────────────────────

function PolicyPreview({
    contractId,
    committed,
    encryptRole,
    decryptRole,
    timeLockEpoch,
    contractSource,
    onContractChange,
    contractModified,
    onResetContract,
    editable,
}: {
    contractId: string;
    committed: boolean;
    encryptRole: string | null;
    decryptRole: string | null;
    timeLockEpoch: number | null;
    contractSource: string;
    onContractChange?: (newSource: string) => void;
    contractModified?: boolean;
    onResetContract?: () => void;
    editable?: boolean;
}) {
    const [contractOpen, setContractOpen] = useState(false);
    const hasAnyParam = encryptRole !== null || decryptRole !== null || timeLockEpoch !== null;

    const editorRef = useRef<HTMLTextAreaElement>(null);
    const highlightRef = useRef<HTMLPreElement>(null);

    const highlightedContract = useMemo(() => {
        return hljs.highlight(contractSource, { language: 'csharp' }).value;
    }, [contractSource]);

    const syncScroll = useCallback(() => {
        if (editorRef.current && highlightRef.current) {
            highlightRef.current.scrollTop = editorRef.current.scrollTop;
            highlightRef.current.scrollLeft = editorRef.current.scrollLeft;
        }
    }, []);

    const handleTabKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const target = e.currentTarget;
            const start = target.selectionStart;
            const end = target.selectionEnd;
            const value = target.value;
            onContractChange?.(value.substring(0, start) + '\t' + value.substring(end));
            requestAnimationFrame(() => {
                target.selectionStart = target.selectionEnd = start + 1;
            });
        }
    };

    return (
        <div className={`policy-preview${committed ? ' policy-preview-committed' : ''}`}>
            <div className="policy-preview-header">
                <span className={`policy-preview-dot${committed ? ' committed' : ''}`} />
                {committed ? "Committed Policy" : "Policy Preview"}
            </div>
            <div className="policy-preview-body">
                <div className="policy-field">
                    <span className="policy-key">version</span>
                    <PolicyTooltip text="The policy version indicates which features it supports. All policies are backwards compatible with previous versions." />
                    <span className="policy-val policy-val-str">&quot;3&quot;</span>
                </div>
                <div className="policy-field">
                    <span className="policy-key">modelId</span>
                    <PolicyTooltip text="The Tide request models this policy is allowed to interact with. The network will reject any request whose ID is not listed here." />
                    <span className="policy-val policy-val-arr">[</span>
                </div>
                <div className="policy-field policy-field-indent">
                    <span className="policy-val policy-val-str">&quot;PolicyEnabledEncryption:1&quot;</span>
                </div>
                <div className="policy-field policy-field-indent">
                    <span className="policy-val policy-val-str">&quot;PolicyEnabledDecryption:1&quot;</span>
                </div>
                <div className="policy-field">
                    <span className="policy-val policy-val-arr">]</span>
                </div>
                <div className="policy-field">
                    <span className="policy-key">contractId</span>
                    <PolicyTooltip text="A SHA-512 hash of your contract's source code (in hex). This links the policy to a specific contract." />
                    <span className="policy-val policy-val-str policy-val-truncate" title={contractId}>
                        &quot;{contractId.substring(0, 16)}...&quot;
                    </span>
                </div>
                <div className="policy-field">
                    <span className="policy-key">executionType</span>
                    <PolicyTooltip text="Controls whether the contract checks the executor's roles and permissions. PRIVATE means the contract will enforce role checks; PUBLIC skips them." />
                    <span className="policy-val policy-val-enum">PRIVATE</span>
                </div>
                <div className="policy-field">
                    <span className="policy-key">approvalType</span>
                    <PolicyTooltip text="Controls whether the contract checks approvers' roles and permissions. IMPLICIT skips approver checks; EXPLICIT requires the contract to verify each approver." />
                    <span className="policy-val policy-val-enum">IMPLICIT</span>
                </div>

                <div className="policy-divider" />

                <div className="policy-field">
                    <span className="policy-key">params</span>
                    <PolicyTooltip text="Custom values passed to the contract, such as EncryptionRealmRole or DecryptTimeLock. Think of the contract as a reusable function and params as its arguments." />
                    <span className="policy-val policy-val-arr">
                        {hasAnyParam ? "{" : "{ }"}
                    </span>
                    {!hasAnyParam && (
                        <span className="policy-hint">no restrictions</span>
                    )}
                </div>

                {hasAnyParam && (
                    <>
                        {encryptRole !== null && (
                            <div className="policy-field policy-field-indent policy-field-active">
                                <span className="policy-key">EncryptionRealmRole</span>
                                {encryptRole ? (
                                    <span className="policy-val policy-val-str">&quot;{encryptRole}&quot;</span>
                                ) : (
                                    <span className="policy-val policy-val-placeholder">awaiting value...</span>
                                )}
                            </div>
                        )}
                        {decryptRole !== null && (
                            <div className="policy-field policy-field-indent policy-field-active">
                                <span className="policy-key">DecryptionRealmRole</span>
                                {decryptRole ? (
                                    <span className="policy-val policy-val-str">&quot;{decryptRole}&quot;</span>
                                ) : (
                                    <span className="policy-val policy-val-placeholder">awaiting value...</span>
                                )}
                            </div>
                        )}
                        {timeLockEpoch !== null && (
                            <div className="policy-field policy-field-indent policy-field-active">
                                <span className="policy-key">DecryptTimeLock</span>
                                {timeLockEpoch ? (
                                    <span className="policy-val policy-val-num">
                                        {timeLockEpoch}
                                        <span className="policy-hint">
                                            {new Date(timeLockEpoch * 1000).toLocaleDateString()}
                                        </span>
                                    </span>
                                ) : (
                                    <span className="policy-val policy-val-placeholder">pick a date...</span>
                                )}
                            </div>
                        )}
                        <div className="policy-field">
                            <span className="policy-val policy-val-arr">{"}"}</span>
                        </div>
                    </>
                )}

                <div className="policy-divider" />

                <div
                    className="contract-toggle"
                    onClick={() => setContractOpen(prev => !prev)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setContractOpen(prev => !prev); }}
                >
                    <span className={`contract-chevron${contractOpen ? ' open' : ''}`}>
                        {'\u25B6'}
                    </span>
                    {contractOpen
                        ? (editable ? "Hide contract editor" : "Hide contract source")
                        : (editable ? "Edit contract source" : "View contract source")
                    }
                </div>
                {contractOpen && (
                    <div className="contract-source">
                        <div className="contract-source-header">
                            <span>
                                ForsetiContract.cs
                                {contractModified && (
                                    <span className="contract-modified-badge">modified</span>
                                )}
                            </span>
                            <span className="contract-source-header-actions">
                                <span className="contract-source-lines">
                                    {contractSource.split('\n').length} lines
                                </span>
                                {contractModified && editable && onResetContract && (
                                    <button
                                        className="contract-reset-btn"
                                        onClick={onResetContract}
                                    >
                                        Reset to default
                                    </button>
                                )}
                            </span>
                        </div>
                        {editable && contractModified && (
                            <div className="contract-warning">
                                This contract will be uploaded to the Forseti ORK network and will
                                govern encryption/decryption access control. The contract ID updates
                                automatically with every edit.
                            </div>
                        )}
                        {editable ? (
                            <div className="contract-editor-wrap">
                                <pre
                                    className="contract-source-code contract-highlight-layer"
                                    ref={highlightRef}
                                    aria-hidden="true"
                                >
                                    <code dangerouslySetInnerHTML={{ __html: highlightedContract }} />
                                    {/* trailing newline so pre height matches textarea */}
                                    {'\n'}
                                </pre>
                                <textarea
                                    className="contract-source-editor"
                                    ref={editorRef}
                                    value={contractSource}
                                    onChange={(e) => onContractChange?.(e.target.value)}
                                    onScroll={syncScroll}
                                    onKeyDown={handleTabKey}
                                    spellCheck={false}
                                    autoComplete="off"
                                    autoCorrect="off"
                                />
                            </div>
                        ) : (
                            <pre className="contract-source-code">
                                <code dangerouslySetInnerHTML={{ __html: highlightedContract }} />
                            </pre>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function HomePage() {
    const {
        isAuthenticated, isLoading, vuid, userId, tokenRoles,
        refreshToken,
        initializeTideRequest, approveTideRequests, executeTideRequest,
        doEncrypt, doDecrypt,
    } = useAuth();

    // Editable contract state
    const [editedContract, setEditedContract] = useState(defaultForsetiContract);
    const [contractModified, setContractModified] = useState(false);

    // Contract ID (SHA-512 of contract source, debounced)
    const [forsetiContractId, setForsetiContractId] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => {
            computeContractId(editedContract).then(setForsetiContractId);
        }, 300);
        return () => clearTimeout(timer);
    }, [editedContract]);

    // Policy state
    const [pendingPolicies, setPendingPolicies] = useState<PendingPolicy[]>([]);
    const [forsetiPolicy, setForsetiPolicy] = useState<Uint8Array | null>(null);
    const [policyLoaded, setPolicyLoaded] = useState(false);
    const [committedParams, setCommittedParams] = useState<{
        encryptRole: string | null;
        decryptRole: string | null;
        timeLockEpoch: number | null;
    } | null>(null);

    // Policy creation toggles
    const [requireEncryptRole, setRequireEncryptRole] = useState(false);
    const [encryptRole, setEncryptRole] = useState("");
    const [requireDecryptRole, setRequireDecryptRole] = useState(false);
    const [decryptRole, setDecryptRole] = useState("");
    const [setTimeLock, setSetTimeLock] = useState(false);
    const [timeLockDate, setTimeLockDate] = useState("");

    // Encryption state
    const [plaintext, setPlaintext] = useState("");
    const [encryptedResult, setEncryptedResult] = useState("");

    // Decryption state
    const [encryptedInput, setEncryptedInput] = useState("");
    const [decryptedResult, setDecryptedResult] = useState("");

    const [loadingAction, setLoadingAction] = useState<string | null>(null);

    const [message, setMessage] = useState("");
    const [messageType, setMessageType] = useState<"info" | "success" | "error">("info");

    const showMessage = (msg: string, type: "info" | "success" | "error" = "info") => {
        setMessage(msg);
        setMessageType(type);
    };

    // ─── Data fetching ──────────────────────────────────────────────────────

    useEffect(() => {
        if (!isLoading && !isAuthenticated) {
            window.location.href = "/";
        }
    }, [isAuthenticated, isLoading]);

    useEffect(() => {
        if (isAuthenticated) {
            refreshAllData();
        }
    }, [isAuthenticated]);

    const refreshAllData = async () => {
        await Promise.all([
            fetchPendingPolicies(),
            fetchForsetiPolicy(),
        ]);
    };

    const fetchPendingPolicies = async () => {
        try {
            const response = await fetch("/api/policies");
            if (response.ok) {
                const data = await response.json();
                const policiesWithDetails = data.map((p: any) => {
                    try {
                        const req = PolicySignRequest.decode(base64ToBytes(p.data));
                        const policy = req.getRequestedPolicy();
                        return {
                            ...p,
                            modelId: policy.modelIds[0],
                            contractId: policy.contractId
                        };
                    } catch {
                        return p;
                    }
                });
                setPendingPolicies(policiesWithDetails);
            }
        } catch (error: any) {
            console.error("Error fetching pending policies:", error);
        }
    };

    const fetchForsetiPolicy = async () => {
        try {
            const response = await fetch("/api/policies?type=committed");
            if (response.ok) {
                const policies: CommittedPolicy[] = await response.json();
                for (const p of policies) {
                    const policy = Policy.from(base64ToBytes(p.data));
                    if (policy.contractId === forsetiContractId) {
                        setForsetiPolicy(policy.toBytes());
                        setPolicyLoaded(true);
                        try {
                            const params = policy.params;
                            const encRole = params?.entries?.get("EncryptionRealmRole");
                            const decRole = params?.entries?.get("DecryptionRealmRole");
                            const tLock = params?.entries?.get("DecryptTimeLock");
                            setCommittedParams({
                                encryptRole: encRole != null ? String(encRole) : null,
                                decryptRole: decRole != null ? String(decRole) : null,
                                timeLockEpoch: tLock != null ? Number(tLock) : null,
                            });
                        } catch {
                            setCommittedParams(null);
                        }
                        return;
                    }
                }
                setPolicyLoaded(false);
            }
        } catch (error: any) {
            console.error("Error fetching Forseti policy:", error);
            setPolicyLoaded(false);
        }
    };

    // ─── Step 2: Policy Handlers ────────────────────────────────────────────

    const handleCreateForsetiPolicy = async () => {
        if (!editedContract.trim()) {
            showMessage("Contract source cannot be empty.", "error");
            return;
        }
        setLoadingAction("create");
        try {
            showMessage("Creating Forseti encryption policy...");
            const vendorId = getVendorIdForPolicy();

            const params = new Map<string, any>();
            if (requireEncryptRole && encryptRole.trim()) {
                params.set("EncryptionRealmRole", encryptRole.trim());
            }
            if (requireDecryptRole && decryptRole.trim()) {
                params.set("DecryptionRealmRole", decryptRole.trim());
            }
            if (setTimeLock && timeLockDate) {
                const epochSeconds = Math.floor(new Date(timeLockDate).getTime() / 1000);
                params.set("DecryptTimeLock", epochSeconds);
            }

            const newPolicyRequest = PolicySignRequest.New(new Policy({
                version: "3",
                modelId: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
                contractId: forsetiContractId,
                keyId: vendorId,
                executionType: ExecutionType.PRIVATE,
                approvalType: ApprovalType.IMPLICIT,
                params: params
            }));
            console.log(params);
            newPolicyRequest.setCustomExpiry(604800); // 1 week
            newPolicyRequest.addForsetiContractToUpload(editedContract);

            const initializedRequest = await initializeTideRequest(newPolicyRequest);

            const response = await fetch("/api/policies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    policyRequest: bytesToBase64(initializedRequest.encode()),
                    requestedBy: vuid
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || "Failed to create Forseti policy");
            }

            showMessage("Forseti policy created. An admin must now review and approve it.", "success");
            await fetchPendingPolicies();
        } catch (error: any) {
            showMessage(`Error creating policy: ${error.message}`, "error");
        } finally {
            setLoadingAction(null);
        }
    };

    const handleReviewPolicy = async (policy: PendingPolicy) => {
        setLoadingAction("review");
        try {
            showMessage(`Reviewing policy ${policy.id.substring(0, 8)}...`);
            const req = PolicySignRequest.decode(base64ToBytes(policy.data));

            const approvalResults = await approveTideRequests([{
                id: policy.id,
                request: req.encode()
            }]);

            const result = approvalResults[0];
            if (result.approved) {
                await fetch("/api/policies", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        policyRequest: bytesToBase64(result.approved.request),
                        decision: { rejected: false },
                        userVuid: vuid
                    })
                });
                showMessage("Policy approved.", "success");
            } else if (result.denied) {
                await fetch("/api/policies", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        policyRequest: bytesToBase64(req.encode()),
                        decision: { rejected: true },
                        userVuid: vuid
                    })
                });
                showMessage("Policy denied.", "error");
            } else {
                showMessage("Policy pending.");
            }

            await fetchPendingPolicies();
        } catch (error: any) {
            showMessage(`Error reviewing policy: ${error.message}`, "error");
        } finally {
            setLoadingAction(null);
        }
    };

    const handleCommitPolicy = async (policy: PendingPolicy) => {
        setLoadingAction("commit");
        try {
            showMessage("Committing policy...");
            const req = PolicySignRequest.decode(base64ToBytes(policy.data));
            const signatures = await executeTideRequest(req.encode(), true);
            const policySignature = signatures[0];

            const response = await fetch("/api/policies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    committed: {
                        id: policy.id,
                        signature: bytesToBase64(policySignature)
                    }
                })
            });

            if (!response.ok) throw new Error("Failed to commit policy");
            showMessage("Policy committed! You can now encrypt and decrypt.", "success");
            await Promise.all([fetchPendingPolicies(), fetchForsetiPolicy()]);
        } catch (error: any) {
            showMessage(`Error committing policy: ${error.message}`, "error");
        } finally {
            setLoadingAction(null);
        }
    };

    // ─── Step 3: Encrypt/Decrypt Handlers ───────────────────────────────────

    const handleEncrypt = async () => {
        if (!plaintext.trim()) {
            showMessage("Please enter text to encrypt.", "error");
            return;
        }
        if (!forsetiPolicy) {
            showMessage("No Forseti policy found. Complete Step 2 first.", "error");
            return;
        }
        setLoadingAction("encrypt");
        try {
            showMessage("Encrypting...");
            const results = await doEncrypt(
                [{ data: plaintext, tags: ["testdata"] }],
                forsetiPolicy
            );
            setEncryptedResult(results[0]);
            showMessage("Encryption successful!", "success");
        } catch (error: any) {
            showMessage(`Encryption error: ${error.message}`, "error");
        } finally {
            setLoadingAction(null);
        }
    };

    const handleDecrypt = async () => {
        if (!encryptedInput.trim()) {
            showMessage("Please enter encrypted data to decrypt.", "error");
            return;
        }
        if (!forsetiPolicy) {
            showMessage("No Forseti policy found. Complete Step 2 first.", "error");
            return;
        }
        setLoadingAction("decrypt");
        try {
            showMessage("Decrypting...");
            const results = await doDecrypt(
                [{ encrypted: encryptedInput, tags: ["testdata"] }],
                forsetiPolicy
            );
            setDecryptedResult(String(results[0]));
            showMessage("Decryption successful!", "success");
        } catch (error: any) {
            showMessage(`Decryption error: ${error.message}`, "error");
        } finally {
            setLoadingAction(null);
        }
    };

    const handleCopyToDecrypt = () => {
        setEncryptedInput(encryptedResult);
    };

    const handleStartAgain = () => {
        setForsetiPolicy(null);
        setPolicyLoaded(false);
        setCommittedParams(null);
        setPendingPolicies([]);
        setRequireEncryptRole(false);
        setEncryptRole("");
        setRequireDecryptRole(false);
        setDecryptRole("");
        setSetTimeLock(false);
        setTimeLockDate("");
        setPlaintext("");
        setEncryptedResult("");
        setEncryptedInput("");
        setDecryptedResult("");
        setEditedContract(defaultForsetiContract);
        setContractModified(false);
        setMessage("");
    };

    // ─── UI Handlers ────────────────────────────────────────────────────────

    const handleLogout = () => {
        IAMService.doLogout();
    };

    const handleRefreshToken = async () => {
        try {
            await refreshToken();
            showMessage("Token refreshed.", "success");
        } catch (error: any) {
            showMessage(`Error refreshing token: ${error.message}`, "error");
        }
    };

    if (isLoading) return <div className="page-container"><p style={{ color: 'var(--text-muted)' }}>Loading...</p></div>;
    if (!isAuthenticated) return <div className="page-container"><p style={{ color: 'var(--text-muted)' }}>Redirecting...</p></div>;

    const username = IAMService.getValueFromIDToken?.("preferred_username") || vuid.substring(0, 16);

    // Resolve preview params: use committed policy params if available, otherwise derive from toggles
    const previewParams = policyLoaded && committedParams
        ? committedParams
        : {
            encryptRole: requireEncryptRole ? encryptRole.trim() || "" : null,
            decryptRole: requireDecryptRole ? decryptRole.trim() || "" : null,
            timeLockEpoch: setTimeLock && timeLockDate
                ? Math.floor(new Date(timeLockDate).getTime() / 1000) || null
                : null,
        };

    return (
        <div className="page-container page-container-with-preview">
            <div className="card">
                {/* ─── Header ──────────────────────────────────────────── */}
                <div className="card-header">
                    <h1>Forseti Crypto Quickstart</h1>
                    <div className="card-header-sub">
                        <span>Signed in as <strong>{username}</strong></span>
                        <code>{vuid.substring(0, 12)}...</code>
                    </div>
                    <div className="card-header-actions">
                        <button onClick={handleLogout} className="btn btn-outline btn-sm">Log out</button>
                        <button onClick={handleRefreshToken} className="btn btn-outline btn-sm">Refresh Token</button>
                        <button onClick={refreshAllData} className="btn btn-outline btn-sm">Refresh Data</button>
                    </div>
                </div>

                <div className="card-body">
                    {/* ─── Message Banner ──────────────────────────────── */}
                    {message && (
                        <div className={`message-banner ${messageType}`}>
                            {message}
                        </div>
                    )}

                    {/* ─── Step 1: Logged In ───────────────────────────── */}
                    <div className="step completed">
                        <div className="step-header">
                            <span className="step-number done">1</span>
                            <span className="step-title">Authenticated</span>
                        </div>
                        <p className="step-success">
                            Signed in as {username}
                        </p>
                    </div>

                    {/* ─── Step 2: Forseti Policy ──────────────────────── */}
                    <div className={`step${policyLoaded ? ' completed' : !policyLoaded && pendingPolicies.length === 0 ? ' active' : ''}`}>
                        <div className="step-header">
                            <span className={`step-number${policyLoaded ? ' done' : ' active'}`}>2</span>
                            <span className="step-title">Forseti Policy</span>
                        </div>

                        {policyLoaded ? (
                            <p className="step-success">Policy loaded and ready to use.</p>
                        ) : (
                            <>
                                <p className="step-description" style={{ marginBottom: '0.75rem' }}>
                                    Configure your encryption policy, then create, approve, and commit it.
                                </p>

                                {pendingPolicies.length === 0 && (
                                    <div>
                                        <Toggle
                                            checked={requireEncryptRole}
                                            onChange={setRequireEncryptRole}
                                            label="Require realm role to encrypt"
                                        >
                                            <input
                                                type="text"
                                                value={encryptRole}
                                                onChange={(e) => setEncryptRole(e.target.value)}
                                                placeholder="e.g. executive"
                                                className="input"
                                            />
                                            <p className={`toggle-hint${encryptRole.trim() ? ' toggle-hint-active' : ''}`}>
                                                Assign this realm role in TideCloak to allow users to encrypt.
                                            </p>
                                        </Toggle>

                                        <Toggle
                                            checked={requireDecryptRole}
                                            onChange={setRequireDecryptRole}
                                            label="Require realm role to decrypt"
                                        >
                                            <input
                                                type="text"
                                                value={decryptRole}
                                                onChange={(e) => setDecryptRole(e.target.value)}
                                                placeholder="e.g. factoryoperator"
                                                className="input"
                                            />
                                            <p className={`toggle-hint${decryptRole.trim() ? ' toggle-hint-active' : ''}`}>
                                                Assign this realm role in TideCloak to allow users to decrypt.
                                            </p>
                                        </Toggle>

                                        <Toggle
                                            checked={setTimeLock}
                                            onChange={setSetTimeLock}
                                            label="Set decryption time lock"
                                        >
                                            <input
                                                type="datetime-local"
                                                value={timeLockDate}
                                                onChange={(e) => setTimeLockDate(e.target.value)}
                                                className="input"
                                            />
                                            <p className="toggle-hint">
                                                Decryption will be blocked until this date and time.
                                            </p>
                                        </Toggle>

                                        <button
                                            onClick={handleCreateForsetiPolicy}
                                            disabled={!!loadingAction}
                                            className="btn btn-primary btn-lg"
                                            style={{ width: '100%', marginTop: '0.75rem' }}
                                        >
                                            {loadingAction === "create" ? "Creating..." : "Create Forseti Policy"}
                                        </button>
                                    </div>
                                )}

                                {pendingPolicies.length > 0 && (
                                    <div>
                                        {pendingPolicies.map((policy) => (
                                            <div key={policy.id} className="pending-card">
                                                <div className="pending-card-meta">
                                                    {policy.contractId ? policy.contractId.substring(0, 20) + "..." : "Unknown contract"}
                                                </div>
                                                <div className="pending-card-status">
                                                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                                        Approvals: {policy.approvedBy?.length || 0}
                                                    </span>
                                                    {policy.commitReady ? (
                                                        <span className="badge badge-ready">Ready to commit</span>
                                                    ) : (
                                                        <span className="badge badge-waiting">Awaiting approvals</span>
                                                    )}
                                                </div>
                                                <div className="pending-card-actions">
                                                    {!policy.approvedBy?.includes(vuid) && !policy.commitReady && (
                                                        <button onClick={() => handleReviewPolicy(policy)} disabled={!!loadingAction} className="btn btn-primary btn-sm">
                                                            {loadingAction === "review" ? "Reviewing..." : "Review & Approve"}
                                                        </button>
                                                    )}
                                                    {policy.commitReady && (
                                                        <button onClick={() => handleCommitPolicy(policy)} disabled={!!loadingAction} className="btn btn-success btn-sm">
                                                            {loadingAction === "commit" ? "Committing..." : "Commit Policy"}
                                                        </button>
                                                    )}
                                                    {policy.approvedBy?.includes(vuid) && !policy.commitReady && (
                                                        <span style={{ fontSize: '0.8rem', color: 'var(--warning)' }}>You have approved this policy</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* ─── Step 3: Encrypt & Decrypt ───────────────────── */}
                    <div className={`step${policyLoaded ? ' active' : ''}`}>
                        <div className="step-header">
                            <span className={`step-number${policyLoaded ? ' active' : ''}`}>3</span>
                            <span className="step-title">Encrypt & Decrypt</span>
                        </div>

                        {!policyLoaded ? (
                            <p className="step-description" style={{ color: 'var(--text-muted)' }}>
                                Complete Step 2 to enable encryption and decryption.
                            </p>
                        ) : (
                            <div className="crypto-grid">
                                {/* ── Encrypt Panel ── */}
                                <div className="crypto-panel">
                                    <h4>Encrypt</h4>
                                    <label className="field-label">Plaintext</label>
                                    <textarea
                                        value={plaintext}
                                        onChange={(e) => setPlaintext(e.target.value)}
                                        placeholder="Enter text to encrypt..."
                                        rows={3}
                                        className="input input-mono"
                                    />
                                    <button
                                        onClick={handleEncrypt}
                                        disabled={loadingAction === "encrypt"}
                                        className="btn btn-primary"
                                        style={{ width: '100%', marginTop: '0.5rem' }}
                                    >
                                        {loadingAction === "encrypt" ? "Encrypting..." : "Encrypt"}
                                    </button>

                                    {encryptedResult && (
                                        <div className="result-box">
                                            <div className="result-label">Encrypted output</div>
                                            <div className="result-value">{encryptedResult}</div>
                                            <button
                                                onClick={handleCopyToDecrypt}
                                                className="btn btn-ghost btn-sm"
                                                style={{ marginTop: '0.5rem', width: '100%' }}
                                            >
                                                Copy to Decrypt
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* ── Decrypt Panel ── */}
                                <div className="crypto-panel">
                                    <h4>Decrypt</h4>
                                    <label className="field-label">Ciphertext</label>
                                    <textarea
                                        value={encryptedInput}
                                        onChange={(e) => setEncryptedInput(e.target.value)}
                                        placeholder="Paste encrypted data..."
                                        rows={3}
                                        className="input input-mono"
                                    />
                                    <button
                                        onClick={handleDecrypt}
                                        disabled={loadingAction === "decrypt"}
                                        className="btn btn-primary"
                                        style={{ width: '100%', marginTop: '0.5rem' }}
                                    >
                                        {loadingAction === "decrypt" ? "Decrypting..." : "Decrypt"}
                                    </button>

                                    {decryptedResult && (
                                        <div className="result-box">
                                            <div className="result-label">Decrypted output</div>
                                            <div className="result-value">{decryptedResult}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ─── Start Again ─────────────────────────────────── */}
                    {policyLoaded && (
                        <div className="start-again-section">
                            <button onClick={handleStartAgain} className="btn btn-muted">
                                Start Again
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <PolicyPreview
                contractId={forsetiContractId}
                committed={policyLoaded}
                encryptRole={previewParams.encryptRole}
                decryptRole={previewParams.decryptRole}
                timeLockEpoch={previewParams.timeLockEpoch}
                contractSource={editedContract}
                onContractChange={(newSource) => {
                    setEditedContract(newSource);
                    setContractModified(true);
                }}
                contractModified={contractModified}
                editable={!policyLoaded && pendingPolicies.length === 0}
                onResetContract={() => {
                    setEditedContract(defaultForsetiContract);
                    setContractModified(false);
                }}
            />
        </div>
    );
}
