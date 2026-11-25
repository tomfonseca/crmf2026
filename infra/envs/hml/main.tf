terraform {
  required_version = ">= 1.14, < 2.0"
  backend "azurerm" {}
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
  storage_use_azuread = true
}

variable "domain" {
  type = string
}

module "foundation" {
  source      = "../../modules/foundation"
  environment = "hml"
  domain      = var.domain
}

output "resource_group_name" {
  value = module.foundation.resource_group_name
}
