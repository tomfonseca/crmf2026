terraform {
  required_version = ">= 1.14, < 2.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["hml", "prd"], var.environment)
    error_message = "Environment must be hml or prd."
  }
}

variable "location" {
  type    = string
  default = "brazilsouth"
}

variable "domain" {
  type        = string
  description = "Platform domain; used by application modules after M0."
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$", var.domain))
    error_message = "Provide a valid lowercase DNS domain."
  }
}

resource "azurerm_resource_group" "main" {
  name     = "rg-crmf-${var.environment}"
  location = var.location
  tags = {
    project     = "crmf"
    environment = var.environment
    managed_by  = "terraform"
  }
}

output "resource_group_name" {
  value = azurerm_resource_group.main.name
}
