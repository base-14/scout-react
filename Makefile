.PHONY: help install build typecheck test test-watch test-coverage test-android \
        lint lint-fix fmt fmt-check check-exports clean audit ci all

NODE_BIN := node_modules/.bin

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	npm ci --no-fund --no-audit

build: ## Build the package — tsup bundles web; tsc emits native unbundled so Metro sees literal require()s
	# Delegates to the npm script so this and `prepare` (which runs on
	# `npm ci` and at publish time) can never drift apart.
	npm run build

typecheck: ## TypeScript check without emit
	$(NODE_BIN)/tsc --noEmit

test: ## Run unit tests
	$(NODE_BIN)/vitest run

test-watch: ## Run unit tests in watch mode
	$(NODE_BIN)/vitest

test-coverage: ## Run unit tests with coverage report
	$(NODE_BIN)/vitest run --coverage

test-android: ## Run the Kotlin unit tests (needs only a JDK 17+; the wrapper fetches Gradle)
	cd android/unit-tests && ./gradlew test --console=plain

lint: ## Run eslint
	$(NODE_BIN)/eslint src

lint-fix: ## Run eslint with autofix
	$(NODE_BIN)/eslint src --fix

fmt: ## Format src with prettier
	$(NODE_BIN)/prettier --write src

fmt-check: ## Verify src formatting
	$(NODE_BIN)/prettier --check src

# Both tools pack the real tarball (which re-runs `prepare`), so they check what
# consumers actually install rather than the working tree.
#
# `cjs-only-exports-default` is ignored deliberately: dist/native is tsc's
# CommonJS output, so its `export default Scout` compiles to
# `exports.default` + `__esModule` without `module.exports`. Metro's babel
# interop honours that, but a Node ESM consumer's `import Scout from
# '.../native'` gets the namespace object instead of the class. Fixing it means
# either dropping the documented default export or patching tsc's output, so
# it stays a known caveat rather than a silent CI failure.
#
# TODO: decide on publint's `"sideEffects": false` suggestion. It would let
# bundlers tree-shake unused instrumentation out of web apps, but it is only
# safe if no module in the graph does real work at import time — and several
# do: 17 modules call `withSuppression(() => require(...))` for optional peers
# at module scope, most of them under src/native/instrumentations/. Those
# requires are exactly the import-time work a `sideEffects: false` claim
# asserts does not happen. Getting it wrong drops telemetry code from
# consumers' production builds silently, with no error to trace it back to.
# Needs a per-module audit of top-level statements plus a bundled-app smoke
# test before flipping — not a one-line change.
check-exports: ## Lint the published exports map + type resolution (publint + attw)
	$(NODE_BIN)/publint
	$(NODE_BIN)/attw --pack . --ignore-rules cjs-only-exports-default

audit: ## Run npm audit (prod + all)
	@echo "--- production ---"
	@npm audit --omit=dev || true
	@echo "--- all ---"
	@npm audit || true

clean: ## Remove build outputs (JS + Kotlin)
	rm -rf dist coverage
	rm -rf android/unit-tests/build android/unit-tests/.gradle android/unit-tests/.kotlin

ci: fmt-check lint typecheck test build check-exports ## Mirror the CI pipeline locally

all: install audit ci ## Install + audit + ci
