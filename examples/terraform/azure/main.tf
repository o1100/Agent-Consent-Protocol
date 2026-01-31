# ACP on Azure — Container Instances with Network Isolation
#
# Deploys ACP and an agent in separate container groups.
# The agent has no internet access (NSG blocks egress).
# ACP has internet access for Telegram API and upstream MCP servers.

terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "telegram_token" {
  type      = string
  sensitive = true
}

variable "telegram_chat_id" {
  type = string
}

variable "location" {
  type    = string
  default = "eastus"
}

resource "azurerm_resource_group" "acp" {
  name     = "rg-acp"
  location = var.location
}

# Virtual network for isolation
resource "azurerm_virtual_network" "acp" {
  name                = "vnet-acp"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.acp.location
  resource_group_name = azurerm_resource_group.acp.name
}

# Subnet for ACP (internet access)
resource "azurerm_subnet" "acp" {
  name                 = "subnet-acp"
  resource_group_name  = azurerm_resource_group.acp.name
  virtual_network_name = azurerm_virtual_network.acp.name
  address_prefixes     = ["10.0.1.0/24"]

  delegation {
    name = "aci"
    service_delegation {
      name = "Microsoft.ContainerInstance/containerGroups"
    }
  }
}

# Subnet for agent (no internet)
resource "azurerm_subnet" "agent" {
  name                 = "subnet-agent"
  resource_group_name  = azurerm_resource_group.acp.name
  virtual_network_name = azurerm_virtual_network.acp.name
  address_prefixes     = ["10.0.2.0/24"]

  delegation {
    name = "aci"
    service_delegation {
      name = "Microsoft.ContainerInstance/containerGroups"
    }
  }
}

# NSG: Block internet for agent subnet
resource "azurerm_network_security_group" "agent" {
  name                = "nsg-agent"
  location            = azurerm_resource_group.acp.location
  resource_group_name = azurerm_resource_group.acp.name

  # Allow traffic to ACP subnet
  security_rule {
    name                       = "allow-acp"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "8443"
    source_address_prefix      = "10.0.2.0/24"
    destination_address_prefix = "10.0.1.0/24"
  }

  # Block all other outbound
  security_rule {
    name                       = "deny-internet"
    priority                   = 200
    direction                  = "Outbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "10.0.2.0/24"
    destination_address_prefix = "Internet"
  }
}

resource "azurerm_subnet_network_security_group_association" "agent" {
  subnet_id                 = azurerm_subnet.agent.id
  network_security_group_id = azurerm_network_security_group.agent.id
}

# ACP Container Instance
resource "azurerm_container_group" "acp" {
  name                = "aci-acp"
  location            = azurerm_resource_group.acp.location
  resource_group_name = azurerm_resource_group.acp.name
  os_type             = "Linux"
  ip_address_type     = "Private"
  subnet_ids          = [azurerm_subnet.acp.id]

  container {
    name   = "acp"
    image  = "ghcr.io/o1100/acp:latest"
    cpu    = "0.5"
    memory = "0.5"

    ports {
      port     = 8443
      protocol = "TCP"
    }

    environment_variables = {
      ACP_CHANNEL          = "telegram"
      ACP_TELEGRAM_CHAT_ID = var.telegram_chat_id
    }

    secure_environment_variables = {
      ACP_TELEGRAM_TOKEN = var.telegram_token
    }
  }
}

# Agent Container Instance
resource "azurerm_container_group" "agent" {
  name                = "aci-agent"
  location            = azurerm_resource_group.acp.location
  resource_group_name = azurerm_resource_group.acp.name
  os_type             = "Linux"
  ip_address_type     = "Private"
  subnet_ids          = [azurerm_subnet.agent.id]

  container {
    name   = "agent"
    image  = "your-agent-image:latest"
    cpu    = "1.0"
    memory = "1.0"

    environment_variables = {
      ACP_PROXY_URL  = "http://${azurerm_container_group.acp.ip_address}:8443"
      MCP_SERVER_URL = "http://${azurerm_container_group.acp.ip_address}:8443"
    }
  }
}

output "acp_ip" {
  value = azurerm_container_group.acp.ip_address
}
