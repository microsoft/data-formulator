// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
// User-assigned managed identity used by the Container App for:
//  - AcrPull on the Container Registry
//  - Cognitive Services OpenAI User on the Azure OpenAI account (no API key needed)

@description('Azure region for this resource.')
param location string

@description('azd environment name, used for resource naming.')
param environmentName string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${environmentName}'
  location: location
}

output identityId string = identity.id
output principalId string = identity.properties.principalId
output clientId string = identity.properties.clientId
