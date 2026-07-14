using 'main.bicep'

param environmentName = 'dataformulator'
param location = 'eastus2'
param resourceGroupName = 'rg-data-formulator'
param containerImage = readEnvironmentVariable(
  'SERVICE_WEB_IMAGE_NAME',
  'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
)
param azureSqlEntraTenantId = readEnvironmentVariable('AZURE_SQL_ENTRA_TENANT_ID', '')
param azureSqlEntraClientId = readEnvironmentVariable('AZURE_SQL_ENTRA_CLIENT_ID', '')
param enableMcpGateway = false
param mcpGatewayContainerImage = readEnvironmentVariable(
  'SERVICE_MCP_GATEWAY_IMAGE_NAME',
  'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
)
param mcpGatewayIssuerUrl = readEnvironmentVariable('MCP_GATEWAY_ISSUER_URL', '')
param mcpGatewayAudience = readEnvironmentVariable('MCP_GATEWAY_AUDIENCE', '')
param mcpGatewayJwksUrl = readEnvironmentVariable('MCP_GATEWAY_JWKS_URL', '')
param mcpGatewayResourceUrl = readEnvironmentVariable('MCP_GATEWAY_RESOURCE_URL', '')
param resourceGroupRingValue = 'r0'
param customDomainName = 'data.gcxteam.com'
param customDomainCertificateId = '/subscriptions/10efa678-7466-47c7-af98-3618bb3b5509/resourceGroups/rg-data-formulator/providers/Microsoft.App/managedEnvironments/cae-dataformulator/managedCertificates/mc-cae-dataformul-data-gcxteam-com-2638'
param infrastructureSubnetNsgId = '/subscriptions/10efa678-7466-47c7-af98-3618bb3b5509/resourceGroups/rg-data-formulator/providers/Microsoft.Network/networkSecurityGroups/vnet-dataformulator-snet-infra-nsg'
param privateEndpointSubnetNsgId = '/subscriptions/10efa678-7466-47c7-af98-3618bb3b5509/resourceGroups/rg-data-formulator/providers/Microsoft.Network/networkSecurityGroups/vnet-dataformulator-snet-privateendpoints-nsg'
param useExistingVirtualNetwork = true
