export const contract = `using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

public class Contract : IAccessPolicy
{
	[PolicyParam(Required = false, Description = "Role required for data encryption")]
    public string EncryptionRealmRole { get; set; }
	
	[PolicyParam(Required = false, Description = "Role required for data decryption")]
    public string DecryptionRealmRole { get; set; }
	
	[PolicyParam(Required = false, Description = "Optional value to only allow data decrpytion at a certain epoch time")]
    public int DecryptTimeLock { get; set; }
	
	private bool isEncryptionRequest = false;
	
    public PolicyDecision ValidateData(DataContext ctx)
    {
		if(ctx.RequestId == "PolicyEnabledEncryption:1")
		{
			isEncryptionRequest = true;
		}
		else if(ctx.RequestId == "PolicyEnabledDecryption:1")
		{
			isEncryptionRequest = false;
		}
		else
		{
			return PolicyDecision.Deny("This contract must only be used with Policy Enabled Encryption/Decryption requests");
		}
		
		if (ctx.Policy.ExecutionType != ExecutionType.PRIVATE)
		{
			return PolicyDecision.Deny("Policy used against this contract must be EXPLICIT PRIVATE");
		}

		// Enforce Time Lock if decryption request
		if(DecryptTimeLock != null && !isEncryptionRequest) 
		{
			var currentTime = (int)Utils.GetEpochSeconds();
			if(currentTime < DecryptTimeLock)
			{
				return PolicyDecision.Deny("Time lock preventing decryption");
			}
			
		}

        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
		var executor = new DokenDto(ctx.Doken);
		// encryption request and encrytion role set
		if(isEncryptionRequest && EncryptionRealmRole != null)
		{
			return Decision
				.RequireNotExpired(executor)
				.RequireRole(executor, EncryptionRealmRole);
		}
		// decryption request and decryption role set
		else if(!isEncryptionRequest && DecryptionRealmRole != null)
		{
			return Decision
				.RequireNotExpired(executor)
				.RequireRole(executor, DecryptionRealmRole);
		}
		else return PolicyDecision.Allow(); // no restrictions on executor
    }
}`
export async function computeContractId(source: string): Promise<string> {
    const data = new TextEncoder().encode(source);
    const hashBuffer = await crypto.subtle.digest('SHA-512', data);
    const hashArray = new Uint8Array(hashBuffer);
    return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}