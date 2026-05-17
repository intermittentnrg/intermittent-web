folder("intermittent-web-${BRANCH_NAME}")

pipelineJob("intermittent-web-${BRANCH_NAME}/post-pricemap") {
  environmentVariables(TAG: TAG, BRANCH_NAME: BRANCH_NAME)
  properties {
    disableConcurrentBuilds()
    if (BRANCH_NAME == "master") {
      pipelineTriggers {
        triggers {
          cron {
            spec('30 14 * * *')
          }
        }
      }
    }
    logRotator {
      numToKeep(50)
    }
  }
  definition {
    cpsScm {
      scm {
        git {
          remote {
            url('git@git-server:intermittent-web.git')
            credentials('gitolite-jenkins')
          }
          branches(BRANCH_NAME)
          scriptPath('Jenkinsfile.post-pricemap')
        }
      }
    }
  }
}
