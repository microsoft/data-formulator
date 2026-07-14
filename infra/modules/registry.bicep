// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
// Container Registry for the Data Formulator image. Admin user is disabled;
// the Container App's managed identity pulls images via AcrPull RBAC instead.
// Not subject to a CloudGov "disable public access" policy at authoring time,
// so this is kept public (no private endpoint) to avoid unnecessary cost/complexity
// — revisit if a registry-scoped network policy is later assigned to this subscription.

@description('Azure region for this resource.')
param location string

@description('azd environment name, used for resource naming.')
param environmentName string

@description('Principal IDs of identities that should be granted AcrPull.')
param principalIdsForAcrPull array

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: toLower(replace('acr${environmentName}', '-', ''))
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    dataEndpointEnabled: false
    encryption: {
      status: 'disabled'
    }
    policies: {
      azureADAuthenticationAsArmPolicy: {
        status: 'enabled'
      }
    }
    networkRuleBypassAllowedForTasks: false
    roleAssignmentMode: 'LegacyRegistryPermissions'
  }
}

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for principalId in principalIdsForAcrPull: {
    name: guid(registry.id, principalId, acrPullRoleId)
    scope: registry
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
      principalId: principalId
      principalType: 'ServicePrincipal'
    }
  }
]

output loginServer string = registry.properties.loginServer
output registryId string = registry.id
