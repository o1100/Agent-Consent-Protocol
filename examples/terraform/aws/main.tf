# ACP on AWS — Fargate with Network Isolation
#
# Deploys ACP and an agent as Fargate tasks.
# The agent's security group only allows egress to ACP.
# ACP has internet access via NAT Gateway.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "telegram_token" {
  type      = string
  sensitive = true
}

variable "telegram_chat_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-east-1"
}

# VPC
resource "aws_vpc" "acp" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "acp-vpc" }
}

# Public subnet (for NAT Gateway)
resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.acp.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "${var.region}a"

  tags = { Name = "acp-public" }
}

# Private subnet (for ACP — has internet via NAT)
resource "aws_subnet" "acp" {
  vpc_id            = aws_vpc.acp.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "${var.region}a"

  tags = { Name = "acp-private" }
}

# Isolated subnet (for agent — NO internet)
resource "aws_subnet" "agent" {
  vpc_id            = aws_vpc.acp.id
  cidr_block        = "10.0.3.0/24"
  availability_zone = "${var.region}a"

  tags = { Name = "agent-isolated" }
}

# Internet Gateway
resource "aws_internet_gateway" "acp" {
  vpc_id = aws_vpc.acp.id
  tags   = { Name = "acp-igw" }
}

# NAT Gateway for ACP internet access
resource "aws_eip" "nat" {
  domain = "vpc"
}

resource "aws_nat_gateway" "acp" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id
  tags          = { Name = "acp-nat" }
}

# Route tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.acp.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.acp.id
  }
  tags = { Name = "acp-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "acp" {
  vpc_id = aws_vpc.acp.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.acp.id
  }
  tags = { Name = "acp-private-rt" }
}

resource "aws_route_table_association" "acp" {
  subnet_id      = aws_subnet.acp.id
  route_table_id = aws_route_table.acp.id
}

# Agent subnet: NO route to internet (only local VPC traffic)
resource "aws_route_table" "agent" {
  vpc_id = aws_vpc.acp.id
  # No default route = no internet
  tags = { Name = "agent-isolated-rt" }
}

resource "aws_route_table_association" "agent" {
  subnet_id      = aws_subnet.agent.id
  route_table_id = aws_route_table.agent.id
}

# Security Groups
resource "aws_security_group" "acp" {
  name_prefix = "acp-"
  vpc_id      = aws_vpc.acp.id

  # Allow inbound from agent
  ingress {
    from_port   = 8443
    to_port     = 8443
    protocol    = "tcp"
    cidr_blocks = ["10.0.3.0/24"]
  }

  # Allow all outbound (internet for Telegram, MCP servers)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "acp-sg" }
}

resource "aws_security_group" "agent" {
  name_prefix = "agent-"
  vpc_id      = aws_vpc.acp.id

  # Only allow outbound to ACP
  egress {
    from_port       = 8443
    to_port         = 8443
    protocol        = "tcp"
    security_groups = [aws_security_group.acp.id]
  }

  tags = { Name = "agent-sg" }
}

# ECS Cluster
resource "aws_ecs_cluster" "acp" {
  name = "acp-cluster"
}

# ECS Task Definitions and Services would go here
# (omitted for brevity — follow standard Fargate patterns)

output "vpc_id" {
  value = aws_vpc.acp.id
}
