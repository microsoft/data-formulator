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
param resourceGroupRingValue = 'r0'
param customDomainName = 'data.gcxteam.com'
param customDomainCertificateId = '/subscriptions/10efa678-7466-47c7-af98-3618bb3b5509/resourceGroups/rg-data-formulator/providers/Microsoft.App/managedEnvironments/cae-dataformulator/managedCertificates/mc-cae-dataformul-data-gcxteam-com-2638'
param infrastructureSubnetNsgId = '/subscriptions/10efa678-7466-47c7-af98-3618bb3b5509/resourceGroups/rg-data-formulator/providers/Microsoft.Network/networkSecurityGroups/vnet-dataformulator-snet-infra-nsg'
param privateEndpointSubnetNsgId = '/subscriptions/10efa678-7466-47c7-af98-3618bb3b5509/resourceGroups/rg-data-formulator/providers/Microsoft.Network/networkSecurityGroups/vnet-dataformulator-snet-privateendpoints-nsg'
param useExistingVirtualNetwork = true
