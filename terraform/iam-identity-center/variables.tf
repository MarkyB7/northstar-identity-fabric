variable "aws_region" {
  description = "AWS region where IAM Identity Center is enabled."
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS account ID to assign permission sets to."
  type        = string
}

variable "eng_group_name" {
  description = "IAM Identity Center group name for engineering users."
  type        = string
  default     = "ENG-DEV"
}

variable "security_group_name" {
  description = "IAM Identity Center group name for security users."
  type        = string
  default     = "SEC-ANALYST"
}

variable "contractor_group_name" {
  description = "IAM Identity Center group name for contractor users."
  type        = string
  default     = "CONTRACTOR"
}
