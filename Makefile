PORT ?= 9877
COMPOSE ?= docker compose
SERVICE := control-center

.DEFAULT_GOAL := help
.PHONY: help setup control-center cypress-open up down logs build \
	user-add user-list user-passwd user-delete \
	user-add-docker user-list-docker user-passwd-docker user-delete-docker

help:
	@echo "\033[1;35mLocal\033[0m"
	@echo "  make setup                     Install dependencies, create cypress.env.json and .env from the examples"
	@echo "  make control-center            Start the Control Center on http://localhost:$(PORT)"
	@echo "  make cypress-open              Open the Cypress app"
	@echo ""
	@echo "\033[1;35mDocker\033[0m"
	@echo "  make up | down | logs | build  Manage the Control Center container"
	@echo ""
	@echo "\033[1;35mUsers\033[0m (append -docker to run inside the container)"
	@echo "  make user-add NAME=<u> PASS=<p> [ROLE=admin]"
	@echo "  make user-list"
	@echo "  make user-passwd NAME=<u> PASS=<p>"
	@echo "  make user-delete NAME=<u>"

setup:
	npm ci
	@test -f cypress.env.json || (cp cypress.env.example.json cypress.env.json && echo "Created cypress.env.json — adjust the stage URLs")
	@test -f .env || (cp .env.example .env && sed -i.bak "s/^SESSION_SECRET=.*/SESSION_SECRET=$$(openssl rand -hex 32)/" .env && rm -f .env.bak && echo "Created .env with a random SESSION_SECRET")

control-center:
	set -a; [ -f .env ] && . ./.env; set +a; PORT=$(PORT) npm run control-center

cypress-open:
	npm run cy:open

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f $(SERVICE)

build:
	$(COMPOSE) build

define require
	@if [ -z "$($(1))" ]; then echo "Missing $(1)=…"; exit 2; fi
endef

user-add:
	$(call require,NAME)
	$(call require,PASS)
	node scripts/manage-user.js add "$(NAME)" "$(PASS)" $(ROLE)

user-list:
	node scripts/manage-user.js list

user-passwd:
	$(call require,NAME)
	$(call require,PASS)
	node scripts/manage-user.js passwd "$(NAME)" "$(PASS)"

user-delete:
	$(call require,NAME)
	node scripts/manage-user.js delete "$(NAME)"

user-add-docker:
	$(call require,NAME)
	$(call require,PASS)
	$(COMPOSE) exec $(SERVICE) node scripts/manage-user.js add "$(NAME)" "$(PASS)" $(ROLE)

user-list-docker:
	$(COMPOSE) exec $(SERVICE) node scripts/manage-user.js list

user-passwd-docker:
	$(call require,NAME)
	$(call require,PASS)
	$(COMPOSE) exec $(SERVICE) node scripts/manage-user.js passwd "$(NAME)" "$(PASS)"

user-delete-docker:
	$(call require,NAME)
	$(COMPOSE) exec $(SERVICE) node scripts/manage-user.js delete "$(NAME)"
