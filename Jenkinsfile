env.TAG = "${env.BRANCH_NAME}-${env.BUILD_NUMBER}"

def deployBranch = env.BRANCH_NAME == "master" || env.BRANCH_NAME == "production"
def secretName = "intermittent-web-master"

properties([
  disableConcurrentBuilds(),
  buildDiscarder(logRotator(artifactDaysToKeepStr: '', artifactNumToKeepStr: '', daysToKeepStr: '', numToKeepStr: '50')),
  [
    $class         : 'BuildBlockerProperty',
    blockingJobs   : "intermittent-web-${env.BRANCH_NAME}/.*",
    blockLevel     : 'GLOBAL',
    scanQueueFor   : 'BUILDABLE',
    useBuildBlocker: true
  ]
])

stage('kaniko') {
  podTemplate(yaml: '''
kind: Pod
spec:
  containers:
    - name: kaniko
      image: gcr.io/kaniko-project/executor:v1.15.0-debug
      command: ['/busybox/cat']
      tty: true
      securityContext:
        runAsUser: 0
        privileged: true
      resources:
        requests:
          memory: "2Gi"
          cpu: "0.5"
'''
  ) {
    node(POD_LABEL) {
      checkout scm
      container('kaniko') {
        timeout(time: 20, unit: 'MINUTES') {
          sh "/kaniko/executor -f Dockerfile -c . --cache=true --insecure --destination=docker-registry.docker-registry:5000/intermittent-web:${env.TAG} --destination=docker-registry.docker-registry:5000/intermittent-web:latest"
        }
      }
    }
  }
}

podTemplate(yaml: """
kind: Pod
spec:
  containers:
    - name: app
      image: docker-registry:5000/intermittent-web:${env.TAG}
      command: ['/bin/sh', '-c', 'cat']
      tty: true
      envFrom:
        - secretRef:
            name: ${secretName}
      resources:
        requests:
          cpu: "0.5"
          memory: "0.5Gi"
"""
) {
  node(POD_LABEL) {
    container('app') {
      stage('test app') {
        timeout(time: 10, unit: 'MINUTES') {
          try {
            sh 'cd /app ; mkdir tmp ; npm run test:e2e'
          } finally {
            sh 'cp -r /app/tmp .'
            junit testResults: 'tmp/test-results.xml', allowEmptyResults: true
            archiveArtifacts artifacts: 'tmp/wdio-screenshots/*.png', allowEmptyArchive: true
          }
        }
      }
      stage('jobdsl') {
        sh "cp /app/jobdsl.groovy ."
        jobDsl(targets: 'jobdsl.groovy',
               additionalParameters: [
                   TAG: env.TAG,
                   BRANCH_NAME: env.BRANCH_NAME
               ],
               removedJobAction: 'DELETE'
        )
      }
    }
  }
}

podTemplate(yaml: """
kind: Pod
spec:
  containers:
    - name: app
      image: alpine/helm:4
      command: ['/bin/cat']
      tty: true
      envFrom:
        - secretRef:
            name: ${secretName}
      resources:
        requests:
          cpu: "0.1"
          memory: "0.5Gi"
"""
) {
  node(POD_LABEL) {
    container('app') {
      stage('helm upgrade') {
        if (deployBranch) {
          checkout scm
          sh """
cd infra/helm
helm repo add bjw-s https://bjw-s-labs.github.io/helm-charts
set +x
helm upgrade --install intermittent-web bjw-s/app-template \
  -n intermittency \
  -f values.yaml \
  --set controllers.main.containers.main.image.tag=${env.TAG} \
  --set secrets.secret.stringData.DATABASE_URL=\${DATABASE_URL} \
  --set secrets.secret.stringData.PGSCHEMA=\${PGSCHEMA} \
  --set secrets.secret.stringData.GOOGLE_ANALYTICS_ID=\${GOOGLE_ANALYTICS_ID}
          """
        } else {
          echo "Skipping deploy for branch ${env.BRANCH_NAME}"
        }
      }
    }
  }
}
