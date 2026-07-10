// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
// Virtual network for the Container Apps environment (VNet integration) and the
// private endpoint used by the CloudGov-mandated private Azure OpenAI account.
//
// Subnet sizing: Container Apps Consumption-only VNet integration requires a
// dedicated, delegated /27 or larger infrastructure subnet; /23 leaves headroom
// for a future workload-profile environment without re-addressing the VNet.

@description('Azure region for these resources.')
param location string

@description('azd environment name, used for resource naming.')
param environmentName string

@description('Optional network security group ID attached by subscription policy to the infrastructure subnet.')
param infrastructureSubnetNsgId string = ''

@description('Optional network security group ID attached by subscription policy to the private endpoint subnet.')
param privateEndpointSubnetNsgId string = ''

@description('Reference an existing governed VNet instead of updating it.')
param useExistingVirtualNetwork bool = false

var vnetAddressPrefix = '10.20.0.0/16'
var infrastructureSubnetPrefix = '10.20.0.0/23'
var privateEndpointSubnetPrefix = '10.20.2.0/27'

resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = if (!useExistingVirtualNetwork) {
  name: 'vnet-${environmentName}'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [vnetAddressPrefix]
    }
    subnets: [
      {
        name: 'snet-infra'
        properties: {
          addressPrefix: infrastructureSubnetPrefix
          networkSecurityGroup: !empty(infrastructureSubnetNsgId)
            ? {
                id: infrastructureSubnetNsgId
              }
            : null
          // Consumption-only (V1) Container Apps environments must NOT have the
          // Microsoft.App/environments subnet delegation — that delegation is only
          // for other environment types. The platform manages the subnet directly.
        }
      }
      {
        name: 'snet-privateendpoints'
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          networkSecurityGroup: !empty(privateEndpointSubnetNsgId)
            ? {
                id: privateEndpointSubnetNsgId
              }
            : null
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource existingVirtualNetwork 'Microsoft.Network/virtualNetworks@2024-01-01' existing = if (useExistingVirtualNetwork) {
  name: 'vnet-${environmentName}'
}

var virtualNetworkId = useExistingVirtualNetwork ? existingVirtualNetwork.id : vnet.id
var infrastructureSubnetId = '${virtualNetworkId}/subnets/snet-infra'
var privateEndpointSubnetId = '${virtualNetworkId}/subnets/snet-privateendpoints'

// Private DNS zone for the Azure OpenAI private endpoint (CloudGov requires
// publicNetworkAccess: Disabled on Cognitive Services accounts).
resource openAiPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.openai.azure.com'
  location: 'global'
}

resource openAiPrivateDnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: openAiPrivateDnsZone
  name: 'link-${environmentName}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetworkId
    }
  }
}

output virtualNetworkId string = virtualNetworkId
output infrastructureSubnetId string = infrastructureSubnetId
output privateEndpointSubnetId string = privateEndpointSubnetId
output openAiPrivateDnsZoneId string = openAiPrivateDnsZone.id
