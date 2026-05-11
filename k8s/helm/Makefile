install:
	helm repo add bjw-s https://bjw-s-labs.github.io/helm-charts
	helm upgrade --install intermittent-web bjw-s/app-template \
		-n intermittency -f values.yaml -f values-dev.yaml --set controllers.main.containers.main.image.tag=latest

uninstall:
	helm uninstall -n intermittency intermittent-web
