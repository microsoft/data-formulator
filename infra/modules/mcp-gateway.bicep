// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
// Internal, stateless MCP gateway for the Fabric-only pilot. The dedicated
// Entra application settings are required at deployment and must not be stored
// in source control.

@description('Azure region for this resource.')
param location string

@description('azd environment name, used for resource naming.')
param environmentName string

@description('Gateway container image reference supplied by azd deployment.')
param containerImage string

@description('Existing Container Apps managed environment resource ID.')
param managedEnvironmentId string

@description('User-assigned managed identity resource ID for the gateway.')
param userAssignedIdentityId string

@description('Login server of the Container Registry.')
param containerRegistryLoginServer string

@secure()
@description('Application Insights connection string.')
param applicationInsightsConnectionString string

@description('Dedicated gateway Entra issuer URL.')
param gatewayIssuerUrl string

@description('Dedicated gateway Entra application audience.')
param gatewayAudience string

@description('Dedicated gateway Entra JWKS URL.')
param gatewayJwksUrl string

@description('Gateway MCP resource-server URL used for OAuth protected-resource metadata.')
param gatewayResourceUrl string

resource gateway 'Microsoft.App/containerApps@2025-01-01' = {
  name: 'ca-${environmentName}-mcp'
  location: location
  tags: {
    'azd-service-name': 'mcp-gateway'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      ingress: {
        external: false
        targetPort: 8080
        transport: 'http2'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: containerRegistryLoginServer
          identity: userAssignedIdentityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'mcp-gateway'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 30
            }
          ]
          env: [
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: applicationInsightsConnectionString }
            { name: 'MCP_GATEWAY_ISSUER_URL', value: gatewayIssuerUrl }
            { name: 'MCP_GATEWAY_AUDIENCE', value: gatewayAudience }
            { name: 'MCP_GATEWAY_JWKS_URL', value: gatewayJwksUrl }
            { name: 'MCP_GATEWAY_RESOURCE_URL', value: gatewayResourceUrl }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output gatewayId string = gateway.id
output internalFqdn string = gateway.properties.configuration.ingress.fqdn
