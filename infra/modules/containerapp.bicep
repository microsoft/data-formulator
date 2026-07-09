// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
// VNet-integrated Container Apps environment + the Data Formulator container app.
// External HTTPS ingress on port 5567 (matches the Dockerfile's EXPOSE/ENTRYPOINT).

@description('Azure region for these resources.')
param location string

@description('azd environment name, used for resource naming.')
param environmentName string

@description('Container image reference (azd overwrites this after building/pushing).')
param containerImage string

@description('Subnet ID for the Container Apps environment VNet integration.')
param infrastructureSubnetId string

@description('Log Analytics workspace ID for the Container Apps environment.')
param logAnalyticsWorkspaceId string

@secure()
@description('Application Insights connection string.')
param applicationInsightsConnectionString string

@description('User-assigned managed identity resource ID attached to the container app.')
param userAssignedIdentityId string

@description('Client ID of the user-assigned managed identity (used for ACR pull auth).')
param userAssignedIdentityClientId string

@description('Login server of the Container Registry.')
param containerRegistryLoginServer string

@description('Azure OpenAI account endpoint (private).')
param azureOpenAiEndpoint string

@description('Azure OpenAI model deployment name.')
param azureOpenAiDeploymentName string

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: last(split(logAnalyticsWorkspaceId, '/'))
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${environmentName}'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: infrastructureSubnetId
      internal: false
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-${environmentName}'
  location: location
  // azd maps the "web" service in azure.yaml to whichever resource carries this tag.
  tags: {
    'azd-service-name': 'web'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 5567
        transport: 'auto'
      }
      registries: [
        {
          server: containerRegistryLoginServer
          identity: userAssignedIdentityId
        }
      ]
      secrets: [
        {
          name: 'flask-secret-key'
          #disable-next-line use-secure-value-for-secure-inputs // Container Apps secrets have no secure-value alternative; value is the only supported property.
          value: uniqueString(subscription().subscriptionId, resourceGroup().id, 'flask-secret')
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'data-formulator'
          image: containerImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            { name: 'AZURE_ENABLED', value: 'true' }
            { name: 'AZURE_API_BASE', value: azureOpenAiEndpoint }
            { name: 'AZURE_MODELS', value: azureOpenAiDeploymentName }
            { name: 'AZURE_CLIENT_ID', value: userAssignedIdentityClientId }
            { name: 'DISABLE_DISPLAY_KEYS', value: 'true' }
            { name: 'FLASK_SECRET_KEY', secretRef: 'flask-secret-key' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: applicationInsightsConnectionString }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
output containerAppId string = containerApp.id
