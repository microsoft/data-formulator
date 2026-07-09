// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
// Azure OpenAI account, locked down per this subscription's CloudGov policies:
//   - "Local Authentication for Azure OpenAI resources must be disabled"
//   - "Public network access on Azure OpenAI resources must be disabled"
// The app (py-src/data_formulator/agents/client_utils.py) already supports this:
// when AZURE_API_KEY is unset it falls back to DefaultAzureCredential + a bearer
// token provider, so the Container App's managed identity is all it needs —
// granted via the "Cognitive Services OpenAI User" role below.

@description('Azure region for this resource. Must support the chosen model deployment.')
param location string

@description('azd environment name, used for resource naming.')
param environmentName string

@description('Subnet ID for the private endpoint.')
param privateEndpointSubnetId string

@description('Principal ID of the identity that should be granted Cognitive Services OpenAI User.')
param principalIdForOpenAiUser string

@description('Model to deploy.')
param modelName string = 'gpt-5.4-mini'

@description('Model version to deploy.')
param modelVersion string = '2026-03-17'

@description('Deployment capacity in units of 1,000 TPM.')
param modelCapacity int = 260

@description('Additional model deployments on the same account, exposed alongside the primary model via AZURE_MODELS so the UI can select between them for side-by-side comparison.')
// GPT-5.5 is the preferred high-performance comparison, but this subscription
// currently has zero GPT-5.5 quota in every checked region. Add it after quota
// is granted; GPT-5.4 Pro is intentionally omitted because of its high cost.
param additionalModels array = [
  { name: 'gpt-5.4-nano', version: '2026-03-17', capacity: 2009 }
  { name: 'gpt-5.4', version: '2026-03-05', capacity: 260 }
]

var cognitiveServicesOpenAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
var accountName = 'aoai-${environmentName}'
var additionalModelNames = [for m in additionalModels: m.name]

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: accountName
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: accountName
    disableLocalAuth: true
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
    }
    // CloudGov "Ensure Data Loss Prevention is enabled for Azure AI service resources":
    // restrict outbound calls to an explicit allow-list (empty = no third-party egress).
    restrictOutboundNetworkAccess: true
    allowedFqdnList: []
  }
}

// CloudGov "Apply input content filter for sexual content/hate for OpenAI": the
// service-wide default filters aren't recognized by policy evaluation — an explicit
// RAI policy resource is required, referenced by the deployment below.
resource contentFilterPolicy 'Microsoft.CognitiveServices/accounts/raiPolicies@2025-06-01' = {
  parent: account
  name: 'data-formulator-content-filter'
  properties: {
    basePolicyName: 'Microsoft.Default'
    mode: 'Default'
    contentFilters: [
      { name: 'Hate', enabled: true, blocking: true, severityThreshold: 'Medium', source: 'Prompt' }
      { name: 'Hate', enabled: true, blocking: true, severityThreshold: 'Medium', source: 'Completion' }
      { name: 'Sexual', enabled: true, blocking: true, severityThreshold: 'Medium', source: 'Prompt' }
      { name: 'Sexual', enabled: true, blocking: true, severityThreshold: 'Medium', source: 'Completion' }
      { name: 'Violence', enabled: true, blocking: true, severityThreshold: 'Medium', source: 'Prompt' }
      { name: 'Violence', enabled: true, blocking: true, severityThreshold: 'Medium', source: 'Completion' }
      { name: 'Selfharm', enabled: true, blocking: true, severityThreshold: 'Medium', source: 'Prompt' }
      { name: 'Selfharm', enabled: true, blocking: true, severityThreshold: 'Medium', source: 'Completion' }
    ]
  }
}

resource modelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: modelName
  sku: {
    name: 'GlobalStandard'
    capacity: modelCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    raiPolicyName: contentFilterPolicy.name
  }
}

// Cognitive Services deployments on the same account must be applied
// sequentially — concurrent PUTs against sibling deployments can 429/409
// (the same class of race hit with the private endpoint below). @batchSize(1)
// forces Bicep to deploy the array one item at a time instead of in parallel.
@batchSize(1)
resource additionalModelDeployments 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = [
  for m in additionalModels: {
    parent: account
    name: m.name
    sku: {
      name: 'GlobalStandard'
      capacity: m.capacity
    }
    properties: {
      model: {
        format: 'OpenAI'
        name: m.name
        version: m.version
      }
      raiPolicyName: contentFilterPolicy.name
    }
    dependsOn: [modelDeployment]
  }
]

resource openAiUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, principalIdForOpenAiUser, cognitiveServicesOpenAiUserRoleId)
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      cognitiveServicesOpenAiUserRoleId
    )
    principalId: principalIdForOpenAiUser
    principalType: 'ServicePrincipal'
  }
}

resource privateEndpoint 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: 'pe-${accountName}'
  location: location
  // Explicit dependsOn: concurrent PUTs on the account's child resources
  // (model deployment, RAI policy, role assignment) can transiently flap the
  // parent account's reported provisioningState to "Accepted", which the
  // private endpoint's preflight validation rejects. Force full sequencing.
  dependsOn: [
    modelDeployment
    additionalModelDeployments
    contentFilterPolicy
    openAiUserAssignment
  ]
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'pls-${accountName}'
        properties: {
          privateLinkServiceId: account.id
          groupIds: ['account']
        }
      }
    ]
  }
}

resource openAiPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' existing = {
  name: 'privatelink.openai.azure.com'
}

resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: privateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'openai'
        properties: {
          privateDnsZoneId: openAiPrivateDnsZone.id
        }
      }
    ]
  }
}

output endpoint string = account.properties.endpoint
// Comma-separated list of every deployed model name (primary + additional),
// consumed directly as AZURE_MODELS by data_formulator.model_registry, which
// splits on "," and lists each as a separately selectable model in the UI.
output deploymentName string = join(concat([modelDeployment.name], additionalModelNames), ',')
output accountId string = account.id
