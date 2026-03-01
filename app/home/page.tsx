"use client";

import { useEffect, useState } from "react";
import { IAMService } from "@tidecloak/js";
import { Models } from "tide-js";
const Policy = Models.Policy;
const ExecutionType = Models.ExecutionType;
const ApprovalType = Models.ApprovalType;
import { PolicySignRequest } from "heimdall-tide";
import { useAuth } from "@/hooks/useAuth";
import {
    getUserChangeRequests,
    getClientChangeRequests,
    getRawChangeSetRequest,
    addApproval,
    commitChangeRequest,
    getVendorIdForPolicy,
    ChangeSetRequest,
} from "@/lib/tidecloakApi";
import { bytesToBase64, base64ToBytes } from "@/lib/tideSerialization";
import { contract as forsetiContract, contractid as forsetiContractId } from "@/lib/forsetiContract";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChangeRequest {
    data: any;
    retrievalInfo: ChangeSetRequest;
}

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

// ─── Styles (matching create-nextjs template) ───────────────────────────────

const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f5f5',
    margin: 0,
}

const cardStyle: React.CSSProperties = {
    background: '#fff',
    padding: '2rem',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    textAlign: 'center' as const,
    maxWidth: '660px',
    width: '100%',
}

const buttonStyle: React.CSSProperties = {
    marginTop: '0.5rem',
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    borderRadius: '4px',
    border: 'none',
    background: '#0070f3',
    color: '#fff',
    cursor: 'pointer',
}

const buttonSmall: React.CSSProperties = {
    padding: '0.4rem 0.8rem',
    fontSize: '0.85rem',
    borderRadius: '4px',
    border: 'none',
    background: '#0070f3',
    color: '#fff',
    cursor: 'pointer',
    marginLeft: '0.5rem',
}

const buttonGreen: React.CSSProperties = {
    ...buttonSmall,
    background: '#28a745',
}

const sectionStyle: React.CSSProperties = {
    textAlign: 'left' as const,
    marginTop: '1.5rem',
    padding: '1rem',
    background: '#f9f9f9',
    borderRadius: '6px',
    border: '1px solid #eee',
}

const stepBadge = (active: boolean): React.CSSProperties => ({
    display: 'inline-block',
    padding: '0.2rem 0.6rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    color: '#fff',
    background: active ? '#0070f3' : '#ccc',
    marginRight: '0.5rem',
})

const inputStyle: React.CSSProperties = {
    padding: '0.4rem 0.6rem',
    borderRadius: '4px',
    border: '1px solid #ddd',
    fontSize: '0.9rem',
    width: '100%',
    boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    fontFamily: 'monospace',
    resize: 'vertical' as const,
}

export default function HomePage() {
    const {
        isAuthenticated, isLoading, vuid, userId, tokenRoles,
        getToken, refreshToken,
        initializeTideRequest, approveTideRequests, executeTideRequest,
        doEncrypt, doDecrypt,
    } = useAuth();

    // Policy state
    const [pendingPolicies, setPendingPolicies] = useState<PendingPolicy[]>([]);
    const [forsetiPolicy, setForsetiPolicy] = useState<Uint8Array | null>(null);
    const [policyLoaded, setPolicyLoaded] = useState(false);

    // TideCloak change requests
    const [userChangeRequests, setUserChangeRequests] = useState<ChangeRequest[]>([]);
    const [clientChangeRequests, setClientChangeRequests] = useState<ChangeRequest[]>([]);

    // Encryption state
    const [plaintext, setPlaintext] = useState("");
    const [tag, setTag] = useState("ingredients");
    const [encryptedResult, setEncryptedResult] = useState("");

    // Decryption state
    const [encryptedInput, setEncryptedInput] = useState("");
    const [decryptTag, setDecryptTag] = useState("ingredients");
    const [decryptedResult, setDecryptedResult] = useState("");

    const [message, setMessage] = useState("");

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
            fetchChangeRequests(),
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

    const fetchChangeRequests = async () => {
        try {
            const token = await getToken();
            const [userChanges, clientChanges] = await Promise.all([
                getUserChangeRequests(token),
                getClientChangeRequests(token),
            ]);
            setUserChangeRequests(userChanges);
            setClientChangeRequests(clientChanges);
        } catch (error: any) {
            console.error("Error fetching change requests:", error);
        }
    };

    // ─── Step 2: Policy Handlers ────────────────────────────────────────────

    const handleCreateForsetiPolicy = async () => {
        try {
            setMessage("Creating Forseti encryption policy...");
            const vendorId = getVendorIdForPolicy();

            const newPolicyRequest = PolicySignRequest.New(new Policy({
                version: "3",
                modelId: ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"],
                contractId: forsetiContractId,
                keyId: vendorId,
                executionType: ExecutionType.PRIVATE,
                approvalType: ApprovalType.EXPLICIT,
                params: new Map()
            }));
            newPolicyRequest.setCustomExpiry(604800); // 1 week
            newPolicyRequest.addForsetiContractToUpload(forsetiContract);

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

            setMessage("Forseti policy created. An admin must now review and approve it.");
            await fetchPendingPolicies();
        } catch (error: any) {
            setMessage(`Error creating policy: ${error.message}`);
        }
    };

    const handleReviewPolicy = async (policy: PendingPolicy) => {
        try {
            setMessage(`Reviewing policy ${policy.id.substring(0, 8)}...`);
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
                setMessage(`Policy approved.`);
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
                setMessage(`Policy denied.`);
            } else {
                setMessage(`Policy pending.`);
            }

            await fetchPendingPolicies();
        } catch (error: any) {
            setMessage(`Error reviewing policy: ${error.message}`);
        }
    };

    const handleCommitPolicy = async (policy: PendingPolicy) => {
        try {
            setMessage(`Committing policy...`);
            const req = PolicySignRequest.decode(base64ToBytes(policy.data));
            const signatures = await executeTideRequest(req.encode());
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
            setMessage("Policy committed! You can now use it for encryption/decryption.");
            await Promise.all([fetchPendingPolicies(), fetchForsetiPolicy()]);
        } catch (error: any) {
            setMessage(`Error committing policy: ${error.message}`);
        }
    };

    // ─── TideCloak Change Request Handlers ──────────────────────────────────

    const handleApproveAndCommitChange = async (changeRequest: ChangeRequest) => {
        try {
            const token = await getToken();
            const rawRequest = await getRawChangeSetRequest(changeRequest.retrievalInfo, token);

            const approvalResults = await approveTideRequests([{
                id: changeRequest.retrievalInfo.changeSetId,
                request: rawRequest
            }]);

            const result = approvalResults[0];
            if (result.approved) {
                await addApproval(changeRequest.retrievalInfo, result.approved.request, token);
                await commitChangeRequest(changeRequest.retrievalInfo, token);
                setMessage(`Change request approved and committed.`);
            } else if (result.denied) {
                setMessage(`Change request denied.`);
            }

            await fetchChangeRequests();
        } catch (error: any) {
            setMessage(`Error: ${error.message}`);
        }
    };

    // ─── Step 3: Encrypt/Decrypt Handlers ───────────────────────────────────

    const handleEncrypt = async () => {
        if (!plaintext.trim()) {
            setMessage("Please enter text to encrypt.");
            return;
        }
        if (!forsetiPolicy) {
            setMessage("No Forseti policy found. Complete Step 2 first.");
            return;
        }
        try {
            setMessage("Encrypting...");
            const results = await doEncrypt(
                [{ data: plaintext, tags: [tag] }],
                forsetiPolicy
            );
            setEncryptedResult(results[0]);
            setMessage("Encryption successful!");
        } catch (error: any) {
            setMessage(`Encryption error: ${error.message}`);
        }
    };

    const handleDecrypt = async () => {
        if (!encryptedInput.trim()) {
            setMessage("Please enter encrypted data to decrypt.");
            return;
        }
        if (!forsetiPolicy) {
            setMessage("No Forseti policy found. Complete Step 2 first.");
            return;
        }
        try {
            setMessage("Decrypting...");
            const results = await doDecrypt(
                [{ encrypted: encryptedInput, tags: [decryptTag] }],
                forsetiPolicy
            );
            setDecryptedResult(String(results[0]));
            setMessage("Decryption successful!");
        } catch (error: any) {
            setMessage(`Decryption error: ${error.message}`);
        }
    };

    const handleCopyToDecrypt = () => {
        setEncryptedInput(encryptedResult);
        setDecryptTag(tag);
    };

    // ─── UI Handlers ────────────────────────────────────────────────────────

    const handleLogout = () => {
        IAMService.doLogout();
    };

    const handleRefreshToken = async () => {
        try {
            await refreshToken();
            setMessage("Token refreshed.");
        } catch (error: any) {
            setMessage(`Error refreshing token: ${error.message}`);
        }
    };

    if (isLoading) return <div style={containerStyle}><p style={{ color: '#555' }}>Loading...</p></div>;
    if (!isAuthenticated) return <div style={containerStyle}><p style={{ color: '#555' }}>Redirecting...</p></div>;

    const totalChangeRequests = userChangeRequests.length + clientChangeRequests.length;

    return (
        <div style={containerStyle}>
            <div style={cardStyle}>
                <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Forseti Crypto Quickstart</h1>
                <p style={{ margin: '0.5rem 0', color: '#555', fontSize: '0.9rem' }}>
                    VUID: {vuid.substring(0, 16)}...
                </p>
                <div>
                    <button onClick={handleLogout} style={buttonStyle}>Log out</button>
                    <button onClick={handleRefreshToken} style={{ ...buttonSmall, marginLeft: '0.5rem' }}>Refresh Token</button>
                    <button onClick={refreshAllData} style={{ ...buttonSmall, marginLeft: '0.5rem' }}>Refresh Data</button>
                </div>

                {message && (
                    <p style={{ marginTop: '0.75rem', padding: '0.5rem', background: '#e8f4ff', borderRadius: '4px', fontSize: '0.85rem' }}>
                        {message}
                    </p>
                )}

                {/* ─── TideCloak Change Requests ─────────────────────────────── */}
                {totalChangeRequests > 0 && (
                    <div style={{ ...sectionStyle, border: '1px solid #ffc107', background: '#fff8e1' }}>
                        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>
                            Pending TideCloak Changes ({totalChangeRequests})
                        </h3>
                        <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#666' }}>
                            These must be approved before proceeding.
                        </p>
                        {[...userChangeRequests, ...clientChangeRequests].map((req) => (
                            <div key={req.retrievalInfo.changeSetId} style={{ marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.85rem' }}>
                                    {req.retrievalInfo.changeSetType} - {req.retrievalInfo.actionType}
                                </span>
                                <button onClick={() => handleApproveAndCommitChange(req)} style={buttonSmall}>
                                    Approve & Commit
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* ─── Step 1: Logged In ──────────────────────────────────────── */}
                <div style={sectionStyle}>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>
                        <span style={stepBadge(true)}>1</span> Logged In
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#28a745' }}>
                        Authenticated as {IAMService.getValueFromIDToken?.("preferred_username") || vuid.substring(0, 16)}
                    </p>
                </div>

                {/* ─── Step 2: Forseti Policy ────────────────────────────────── */}
                <div style={sectionStyle}>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>
                        <span style={stepBadge(!policyLoaded)}>2</span> Forseti Policy
                    </h3>

                    {policyLoaded ? (
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#28a745' }}>
                            Forseti policy loaded and ready to use.
                        </p>
                    ) : (
                        <>
                            <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#666' }}>
                                A Forseti policy is required for encryption/decryption. Create one, then have an admin approve and commit it.
                            </p>

                            {pendingPolicies.length === 0 && (
                                <button onClick={handleCreateForsetiPolicy} style={buttonStyle}>
                                    Create Forseti Policy
                                </button>
                            )}

                            {pendingPolicies.length > 0 && (
                                <div style={{ marginTop: '0.75rem' }}>
                                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Pending Policies</h4>
                                    {pendingPolicies.map((policy) => (
                                        <div key={policy.id} style={{ padding: '0.5rem', background: '#fff', borderRadius: '4px', marginBottom: '0.5rem', border: '1px solid #eee' }}>
                                            <div style={{ fontSize: '0.8rem', color: '#666' }}>
                                                Model: {policy.modelId || "Unknown"} | Contract: {policy.contractId ? policy.contractId.substring(0, 16) + "..." : "Unknown"}
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: '#666' }}>
                                                Approvals: {policy.approvedBy?.length || 0} | Ready: {policy.commitReady ? "Yes" : "No"}
                                            </div>
                                            <div style={{ marginTop: '0.4rem' }}>
                                                {!policy.approvedBy?.includes(vuid) && !policy.commitReady && (
                                                    <button onClick={() => handleReviewPolicy(policy)} style={buttonSmall}>
                                                        Review & Approve
                                                    </button>
                                                )}
                                                {policy.commitReady && (
                                                    <button onClick={() => handleCommitPolicy(policy)} style={buttonGreen}>
                                                        Commit Policy
                                                    </button>
                                                )}
                                                {policy.approvedBy?.includes(vuid) && !policy.commitReady && (
                                                    <span style={{ fontSize: '0.8rem', color: '#f0ad4e' }}> Awaiting more approvals</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* ─── Step 3: Encrypt & Decrypt ─────────────────────────────── */}
                <div style={sectionStyle}>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>
                        <span style={stepBadge(policyLoaded)}>3</span> Encrypt & Decrypt
                    </h3>

                    {!policyLoaded ? (
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#999' }}>
                            Complete Step 2 to enable encryption/decryption.
                        </p>
                    ) : (
                        <>
                            {/* Encrypt */}
                            <div style={{ marginBottom: '1rem' }}>
                                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Encrypt</h4>
                                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem', color: '#666' }}>
                                    Valid tags: <code>ingredients</code>, <code>batch amounts</code>, <code>process</code>
                                </p>
                                <div style={{ marginBottom: '0.4rem' }}>
                                    <label style={{ fontSize: '0.85rem' }}>Tag: </label>
                                    <select
                                        value={tag}
                                        onChange={(e) => setTag(e.target.value)}
                                        style={{ ...inputStyle, width: 'auto' }}
                                    >
                                        <option value="ingredients">ingredients</option>
                                        <option value="batch amounts">batch amounts</option>
                                        <option value="process">process</option>
                                    </select>
                                </div>
                                <textarea
                                    value={plaintext}
                                    onChange={(e) => setPlaintext(e.target.value)}
                                    placeholder="Enter text to encrypt"
                                    rows={2}
                                    style={textareaStyle}
                                />
                                <button onClick={handleEncrypt} style={{ ...buttonStyle, marginTop: '0.4rem' }}>
                                    Encrypt
                                </button>

                                {encryptedResult && (
                                    <div style={{ marginTop: '0.5rem' }}>
                                        <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Encrypted result:</label>
                                        <textarea
                                            value={encryptedResult}
                                            readOnly
                                            rows={3}
                                            style={{ ...textareaStyle, background: '#f0f0f0' }}
                                        />
                                        <button onClick={handleCopyToDecrypt} style={buttonSmall}>
                                            Copy to Decrypt
                                        </button>
                                    </div>
                                )}
                            </div>

                            <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '1rem 0' }} />

                            {/* Decrypt */}
                            <div>
                                <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Decrypt</h4>
                                <div style={{ marginBottom: '0.4rem' }}>
                                    <label style={{ fontSize: '0.85rem' }}>Tag: </label>
                                    <select
                                        value={decryptTag}
                                        onChange={(e) => setDecryptTag(e.target.value)}
                                        style={{ ...inputStyle, width: 'auto' }}
                                    >
                                        <option value="ingredients">ingredients</option>
                                        <option value="batch amounts">batch amounts</option>
                                        <option value="process">process</option>
                                    </select>
                                </div>
                                <textarea
                                    value={encryptedInput}
                                    onChange={(e) => setEncryptedInput(e.target.value)}
                                    placeholder="Paste encrypted data here"
                                    rows={3}
                                    style={textareaStyle}
                                />
                                <button onClick={handleDecrypt} style={{ ...buttonStyle, marginTop: '0.4rem' }}>
                                    Decrypt
                                </button>

                                {decryptedResult && (
                                    <div style={{ marginTop: '0.5rem' }}>
                                        <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>Decrypted result:</label>
                                        <textarea
                                            value={decryptedResult}
                                            readOnly
                                            rows={2}
                                            style={{ ...textareaStyle, background: '#f0f0f0' }}
                                        />
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
