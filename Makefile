BRANCH ?= master

update_secret:
	grep -v export .env | kubectl create secret generic -n jenkins intermittent-web-$(BRANCH) --from-env-file=/dev/stdin --dry-run=true -o yaml | kubectl apply -f -
