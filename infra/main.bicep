// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
targetScope = 'subscription'

@description('Name of the environment, used to derive resource names (azd convention).')
param environmentName string

@description('Primary Azure region for all resources.')
param location string = 'eastus2'

@description('Name of the resource group to create.')
param resourceGroupName string = 'rg-data-formulator'

@description('Container image to deploy. Supply the current image when reprovisioning an existing environment.')
param containerImage string

@description('Optional policy-managed resource-group ring tag.')
param resourceGroupRingValue string = ''

@description('Optional custom domain bound to the Container App.')
param customDomainName string = ''

@description('Managed certificate resource ID for the custom domain.')
param customDomainCertificateId string = ''

@description('Optional network security group ID attached to the Container Apps infrastructure subnet.')
param infrastructureSubnetNsgId string = ''

@description('Optional network security group ID attached to the private endpoint subnet.')
param privateEndpointSubnetNsgId string = ''

@description('Reference the governed VNet instead of updating it. Use for environments where policy owns VNet metadata.')
param useExistingVirtualNetwork bool = false

// This subscription is governed by CloudGov policy: Azure OpenAI and Key Vault must have
// local auth / public network access disabled. See infra/README.md for the full rationale.

resource rg 'Microsoft.Resources/resourceGroups@2024-11-01' = {
  name: resourceGroupName
  location: location
  tags: {
    'azd-env-name': environmentName
    ...(!empty(resourceGroupRingValue) ? { ringValue: resourceGroupRingValue } : {})
  }
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: {
    location: location
    environmentName: environmentName
  }
}

module identity 'modules/identity.bicep' = {
  name: 'identity'
  scope: rg
  params: {
    location: location
    environmentName: environmentName
  }
}

module network 'modules/network.bicep' = {
  name: 'network'
  scope: rg
  params: {
    location: location
    environmentName: environmentName
    infrastructureSubnetNsgId: infrastructureSubnetNsgId
    privateEndpointSubnetNsgId: privateEndpointSubnetNsgId
    useExistingVirtualNetwork: useExistingVirtualNetwork
  }
}

module registry 'modules/registry.bicep' = {
  name: 'registry'
  scope: rg
  params: {
    location: location
    environmentName: environmentName
    principalIdForAcrPull: identity.outputs.principalId
  }
}

module openai 'modules/openai.bicep' = {
  name: 'openai'
  scope: rg
  params: {
    location: location
    environmentName: environmentName
    privateEndpointSubnetId: network.outputs.privateEndpointSubnetId
    principalIdForOpenAiUser: identity.outputs.principalId
  }
}

module containerApp 'modules/containerapp.bicep' = {
  name: 'containerapp'
  scope: rg
  params: {
    location: location
    environmentName: environmentName
    containerImage: containerImage
    infrastructureSubnetId: network.outputs.infrastructureSubnetId
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
    applicationInsightsConnectionString: monitoring.outputs.applicationInsightsConnectionString
    userAssignedIdentityId: identity.outputs.identityId
    userAssignedIdentityClientId: identity.outputs.clientId
    containerRegistryLoginServer: registry.outputs.loginServer
    azureOpenAiEndpoint: openai.outputs.endpoint
    azureOpenAiDeploymentName: openai.outputs.deploymentName
    customDomainName: customDomainName
    customDomainCertificateId: customDomainCertificateId
  }
}

output RESOURCE_GROUP_NAME string = rg.name
output AZURE_LOCATION string = location
output SERVICE_WEB_ENDPOINT_URL string = containerApp.outputs.fqdn
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_OPENAI_ENDPOINT string = openai.outputs.endpoint
