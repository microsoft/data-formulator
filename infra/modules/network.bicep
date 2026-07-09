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

var vnetAddressPrefix = '10.20.0.0/16'
var infrastructureSubnetPrefix = '10.20.0.0/23'
var privateEndpointSubnetPrefix = '10.20.2.0/27'

resource vnet 'Microsoft.Network/virtualNetworks@2024-01-01' = {
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
          delegations: [
            {
              name: 'Microsoft.App.environments'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'snet-privateendpoints'
        properties: {
          addressPrefix: privateEndpointSubnetPrefix
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

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
      id: vnet.id
    }
  }
}

output virtualNetworkId string = vnet.id
output infrastructureSubnetId string = vnet.properties.subnets[0].id
output privateEndpointSubnetId string = vnet.properties.subnets[1].id
output openAiPrivateDnsZoneId string = openAiPrivateDnsZone.id
