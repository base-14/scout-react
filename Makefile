.PHONY: help install build typecheck test test-coverage lint lint-fix \
        fmt fmt-check clean audit ci all

NODE_BIN := node_modules/.bin

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	npm ci --no-fund --no-audit

build: ## Build the package — tsup bundles web; tsc emits native unbundled so Metro sees literal require()s
	$(NODE_BIN)/tsup
	$(NODE_BIN)/tsc -p tsconfig.native.json

typecheck: ## TypeScript check without emit
	$(NODE_BIN)/tsc --noEmit

test: ## Run unit tests
	$(NODE_BIN)/vitest run

test-coverage: ## Run unit tests with coverage report
	$(NODE_BIN)/vitest run --coverage

lint: ## Run eslint
	$(NODE_BIN)/eslint src

lint-fix: ## Run eslint with autofix
	$(NODE_BIN)/eslint src --fix

fmt: ## Format src with prettier
	$(NODE_BIN)/prettier --write src

fmt-check: ## Verify src formatting
	$(NODE_BIN)/prettier --check src

audit: ## Run npm audit (prod + all)
	@echo "--- production ---"
	@npm audit --omit=dev || true
	@echo "--- all ---"
	@npm audit || true

clean: ## Remove build outputs
	rm -rf dist coverage

ci: fmt-check lint typecheck test build ## Mirror the CI pipeline locally

all: install audit ci ## Install + audit + ci
