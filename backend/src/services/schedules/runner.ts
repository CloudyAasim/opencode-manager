import { Cron } from 'croner'
import { type ScheduleJob } from '@opencode-manager/shared/types'
import { logger } from '../../utils/logger'
import { ScheduleService } from './service'

interface Stoppable {
  stop(): void
}

function buildIntervalCronExpression(intervalMinutes: number): string | null {
  if (intervalMinutes < 5) {
    return null
  }

  if (intervalMinutes <= 59) {
    return `*/${intervalMinutes} * * * *`
  }

  if (intervalMinutes === 60) {
    return `0 * * * *`
  }

  const hours = intervalMinutes / 60
  if (Number.isInteger(hours) && 24 % hours === 0) {
    return `0 */${hours} * * *`
  }

  const days = intervalMinutes / 1440
  if (Number.isInteger(days)) {
    return `0 0 */${days} * *`
  }

  return null
}

export class ScheduleRunner {
  private cronJobs = new Map<number, Stoppable>()

  constructor(private readonly scheduleService: ScheduleService) {}

  async start(): Promise<void> {
    this.scheduleService.setJobChangeHandler((job, jobId) => {
      if (job) {
        this.registerJob(job)
      } else {
        this.unregisterJob(jobId)
      }
    })

    this.scheduleService.cleanupOrphanedSchedules()

    await this.scheduleService.recoverRunningRuns()
    this.registerAllEnabledJobs()
  }

  stop(): void {
    this.scheduleService.setJobChangeHandler(null)
    for (const stoppable of this.cronJobs.values()) {
      stoppable.stop()
    }
    this.cronJobs.clear()
  }

  registerJob(job: ScheduleJob): void {
    this.unregisterJob(job.id)

    if (!job.enabled) {
      return
    }

    if (job.scheduleMode === 'cron') {
      if (!job.cronExpression) {
        return
      }
      const options: Record<string, unknown> = { protect: true }
      if (job.timezone) {
        options.timezone = job.timezone
      }
      const cron = new Cron(job.cronExpression, options, () => {
        logger.info(`Cron triggered for job ${job.id}: ${job.name}`)
        void this.executeJob(job.repoId, job.id)
      })
      this.cronJobs.set(job.id, cron)
      logger.info(`Cron job created for ${job.id}: next run at ${cron.nextRun()?.toISOString()}`)
      return
    }

    if (!job.intervalMinutes) {
      return
    }

    if (!job.nextRunAt) {
      logger.warn(`Job ${job.id} (${job.name}) has no nextRunAt, skipping registration`)
      return
    }

    const cronExpression = buildIntervalCronExpression(job.intervalMinutes)
    const options: Record<string, unknown> = { protect: true }
    if (job.timezone) {
      options.timezone = job.timezone
    }

    if (cronExpression) {
      const nextRunDate = new Date(job.nextRunAt)
      const now = new Date()

      if (nextRunDate <= now) {
        void this.executeJob(job.repoId, job.id)
      }

      const cronOptions = {
        ...options,
        ...(nextRunDate > now ? { startAt: nextRunDate.toISOString() } : {}),
      }
      const cron = new Cron(cronExpression, cronOptions, () => {
        logger.info(`Cron triggered for job ${job.id}: ${job.name}`)
        void this.executeJob(job.repoId, job.id)
      })
      this.cronJobs.set(job.id, cron)
    } else {
      const intervalMs = job.intervalMinutes * 60_000
      let timeout: ReturnType<typeof setTimeout> | null = null
      let isStopped = false
      let isRunning = false

      const scheduleNext = () => {
        if (isStopped || isRunning) return
        timeout = setTimeout(async () => {
          if (isStopped || isRunning) return
          isRunning = true
          logger.info(`Interval timer triggered for job ${job.id}: ${job.name}`)
          try {
            await this.executeJob(job.repoId, job.id)
          } finally {
            isRunning = false
            scheduleNext()
          }
        }, intervalMs)
      }

      const initialDelay = Math.max(0, job.nextRunAt - Date.now())
      if (initialDelay > 0) {
        timeout = setTimeout(() => {
          if (isStopped || isRunning) return
          isRunning = true
          logger.info(`Interval timer triggered for job ${job.id}: ${job.name}`)
          void this.executeJob(job.repoId, job.id).finally(() => {
            isRunning = false
            scheduleNext()
          })
        }, initialDelay)
      } else {
        if (!isStopped) {
          isRunning = true
          void this.executeJob(job.repoId, job.id).finally(() => {
            isRunning = false
            scheduleNext()
          })
        }
      }

      this.cronJobs.set(job.id, {
        stop: () => {
          isStopped = true
          if (timeout) clearTimeout(timeout)
        }
      })
    }
  }

  unregisterJob(jobId: number): void {
    const existing = this.cronJobs.get(jobId)
    if (existing) {
      existing.stop()
      this.cronJobs.delete(jobId)
    }
  }

  private async executeJob(repoId: number, jobId: number): Promise<void> {
    try {
      await this.scheduleService.runJob(repoId, jobId, 'schedule')
    } catch (error) {
      logger.error(`Scheduled run failed for job ${jobId}:`, error)
    }
  }

  private registerAllEnabledJobs(): void {
    const jobs = this.scheduleService.listAllEnabledJobs()
    logger.info(`Registering ${jobs.length} enabled schedule jobs`)
    for (const job of jobs) {
      try {
        logger.info(`Registering job ${job.id}: ${job.name} (mode=${job.scheduleMode}, cron=${job.cronExpression}, tz=${job.timezone})`)
        this.registerJob(job)
        logger.info(`Job ${job.id} registered, cron jobs map size: ${this.cronJobs.size}`)
      } catch (error) {
        logger.error(`Failed to register job ${job.id}:`, error)
      }
    }
  }
}

