type EventHandler = (...args: any[]) => void;
type Task<T = unknown> = (...args: any[]) => T | PromiseLike<T>;

/** 
 * Represents an object that schedules a function for asynchronous execution.
 * The default implementation used by {@link SequentialTaskQueue} calls {@link setImmediate} when available,
 * and {@link setTimeout} otherwise.
 * @see {@link SequentialTaskQueue.defaultScheduler}
 * @see {@link TaskQueueOptions.scheduler}
 */
export interface Scheduler {
    /**
     * Schedules a callback for asynchronous execution.
     */
    schedule(callback: () => void): void;
}

/**
 * Object used for passing configuration options to the {@link SequentialTaskQueue} constructor.
 */
export interface SequentialTaskQueueOptions {
    /**
     * Assigns a name to the task queue for diagnostic purposes. The name does not need to be unique.
     */
    name?: string;
    /**
     * Default timeout (in milliseconds) for tasks pushed to the queue. Default is 0 (no timeout).
     *  */    
    timeout?: number;
    /**
     * Scheduler used by the queue. Defaults to {@link SequentialTaskQueue.defaultScheduler}. 
     */
    scheduler?: Scheduler;
}

/**
 * Options object for individual tasks.
 */
export interface TaskOptions {
    /**
     * Timeout for the task, in milliseconds. 
     * */
    timeout?: number;

    /**
     * Arguments to pass to the task. Useful for minimalising the number of Function objects and closures created 
     * when pushing the same task multiple times, with different arguments.  
     * 
     * @example
     * // The following code creates a single Function object and no closures:
     * for (let i = 0; i < 100; i++)
     *     queue.push(process, {args: [i]});
     * function process(n) {
     *     console.log(n);
     * }
     */
    args?: unknown;    
}

/**
 * Provides the API for querying and invoking task cancellation.
 */
export interface CancellationToken {
    /**
     * When `true`, indicates that the task has been cancelled. 
     */
    cancelled?: boolean;
    /**
     * An arbitrary object representing the reason of the cancellation. Can be a member of the {@link cancellationTokenReasons} object or an `Error`, etc.  
     */
    reason?: unknown;
    /**
     * Cancels the task for which the cancellation token was created.
     * @param reason - The reason of the cancellation, see {@link CancellationToken.reason} 
     */
    cancel(reason?: unknown): void;
}

/**
 * Standard cancellation reasons. {@link SequentialTaskQueue} sets {@link CancellationToken.reason} 
 * to one of these values when cancelling a task for a reason other than the user code calling
 * {@link CancellationToken.cancel}.    
 */
export const cancellationTokenReasons: { cancel: unknown; timeout: unknown } = {
    /** Used when the task was cancelled in response to a call to {@link SequentialTaskQueue.cancel} */
    cancel: Object.create(null),
    /** Used when the task was cancelled after its timeout has passed */
    timeout: Object.create(null)
}

/**
 * Standard event names used by {@link SequentialTaskQueue}
 */
export const sequentialTaskQueueEvents = {
    drained: "drained",
    error: "error",
    timeout: "timeout"
}

/**
 * Promise interface with the ability to cancel.
 */
export interface CancellablePromiseLike<T> extends Promise<T> {
    /**
     * Cancels (and consequently, rejects) the task associated with the Promise.
     * @param reason - Reason of the cancellation. This value will be passed when rejecting this Promise.
     */
    cancel(reason?: unknown): void;
}

/**
 * FIFO task queue to run tasks in predictable order, without concurrency.
 */
export class SequentialTaskQueue {

    public static defaultScheduler: Scheduler = {
        schedule: callback => setTimeout(callback, 0)
    };

    private queue: TaskEntry[] = [];
    private _isClosed: boolean = false;
    private waiters: ((value?: unknown) => void)[] = [];
    private defaultTimeout?: number;
    private currentTask?: TaskEntry;
    private scheduler: Scheduler;
    private events: { [key: string]: EventHandler[] } = {};

    public name: string;

    /** Indicates if the queue has been closed. Calling {@link SequentialTaskQueue.push} on a closed queue will result in an exception. */
    public get isClosed(): boolean {
        return this._isClosed;
    }

    /** 
     * Creates a new instance of {@link SequentialTaskQueue}
     * @param options - Configuration options for the task queue.
    */
    public constructor(options: SequentialTaskQueueOptions = {}) {
        this.defaultTimeout = options.timeout;
        this.name = options.name || "SequentialTaskQueue";
        this.scheduler = options.scheduler || SequentialTaskQueue.defaultScheduler;
    }

    /**
     * Adds a new task to the queue.
     * @param {Function} task - The function to call when the task is run
     * @param {TaskOptions} options - An object containing arguments and options for the task.
     * @returns {CancellablePromiseLike<T>} A promise that can be used to await or cancel the task.
     */
    public push<T>(task: Task<T>, options: TaskOptions = {}): CancellablePromiseLike<T> {
        if (this._isClosed) {
            throw new Error(`${this.name} has been previously closed`);
        }
        
        const taskEntry: TaskEntry = {
            callback: task,
            args: options && options.args ? (Array.isArray(options.args) ? options.args.slice() : [options.args]) : [],
            timeout: options && options.timeout !== undefined ? options.timeout : this.defaultTimeout,
            cancellationToken: {
                cancel: (reason?: unknown) => this.cancelTask(taskEntry, reason)
            },
            resolve: undefined,
            reject: undefined
        };
        taskEntry.args.push(taskEntry.cancellationToken);
        this.queue.push(taskEntry);
        this.scheduler.schedule(() => this.next());
        const promise = new Promise<T>((resolve, reject) => {
            taskEntry.resolve = resolve;
            taskEntry.reject = reject;
        });
        const result: CancellablePromiseLike<T> = Object.assign(promise, {
            cancel: (reason?: unknown) => taskEntry.cancellationToken.cancel(reason)
        });
        return result;
    }

    /**
     * Cancels the currently running task (if any), and clears the queue.
     * @param {unknown} reason - The reason of the cancellation, see {@link CancellationToken.reason}. Defaults to {@link cancellationTokenReasons.cancel}. 
     * @returns {Promise} A Promise that is fulfilled when the queue is empty and the current task has been cancelled.
     */
    public cancel(reason: unknown = cancellationTokenReasons.cancel): Promise<unknown> {
        if (this.currentTask) {
            this.cancelTask(this.currentTask, reason);
        }
        const queue = this.queue.splice(0);
        // Cancel all and emit a drained event if there were tasks waiting in the queue
        if (queue.length) {
            queue.forEach(task => this.cancelTask(task, reason));
            this.emit(sequentialTaskQueueEvents.drained);
        }
        return this.wait();
    }

    /**
     * Closes the queue, preventing new tasks to be added. 
     * Any calls to {@link SequentialTaskQueue.push} after closing the queue will result in an exception.
     * @param {boolean} cancel - Indicates that the queue should also be cancelled.
     * @param {unknown} reason - The reason of the cancellation, passed to {@link SequentialTaskQueue.cancel} when `cancel` is `true`.
     * @returns {Promise} A Promise that is fulfilled when the queue has finished executing remaining tasks.  
     */
    public close(cancel?: boolean, reason?: unknown): Promise<unknown> {
        if (!this._isClosed) {
            this._isClosed = true;
            if (cancel) {
                return this.cancel(reason);
            }
        }
        return this.wait();
    }

    /**
     * Returns a promise that is fulfilled when the queue is empty.
     * @returns {Promise}
     */
    public wait(): Promise<unknown> {
        if (!this.currentTask && this.queue.length === 0) {
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this.waiters.push(resolve);
        });
    }

    /**
     * Adds an event handler for a named event.
     * @param {string} evt - Event name. See the readme for a list of valid events.
     * @param {Function} handler - Event handler. When invoking the handler, the queue will set itself as the `this` argument of the call. 
     */
    public on(evt: string, handler: EventHandler): void {
        this.events = this.events || {};
        (this.events[evt] || (this.events[evt] = [])).push(handler);     
    }

    /**
     * Adds a single-shot event handler for a named event.
     * @param {string} evt - Event name. See the readme for a list of valid events.
     * @param {Function} handler - Event handler. When invoking the handler, the queue will set itself as the `this` argument of the call. 
     */
    public once(evt: string, handler: EventHandler): void {
        const cb = (...args: any[]): void => {
            this.removeListener(evt, cb);
            handler.apply(this, args);
        };
        this.on(evt, cb);
    }

    /**
     * Removes an event handler.
     * @param {string} evt - Event name
     * @param {Function} handler - Event handler to be removed
     */
    public removeListener(evt: string, handler: EventHandler): void {
        if (!this.events) {
            return;
        }

        const list = this.events[evt];
        if (!list) {
            return;
        }

        let i = 0;
        while (i < list.length) {
            if (list[i] === handler) {
                list.splice(i, 1);
            } else {
                i++;
            }
        }
    }

    /** @see {@link SequentialTaskQueue.removeListener} */
    public off(evt: string, handler: EventHandler): void {
        return this.removeListener(evt, handler);
    }

    protected emit(evt: string, ...args: any[]): void {
        if (!this.events || !this.events[evt]) {
            return;
        }

        try { 
            this.events[evt].forEach(fn => { fn.apply(this, args); });
        } catch (e) {
            console.error(`${this.name}: Exception in '${evt}' event handler`, e);
        }
    }

    protected next(): void {
        // Try running the next task, if not currently running one 
        if (this.currentTask) {
            return;
        }
    
        let tempTask = this.queue.shift();
        // skip cancelled tasks
        while (tempTask && tempTask.cancellationToken.cancelled) {
            tempTask = this.queue.shift();
        }

        if (!tempTask) {
            // queue is empty, call waiters
            this.callWaiters(); 
            return;
        }

        const task = tempTask;

        try {
            this.currentTask = task;

            if (task.timeout) {
                task.timeoutHandle = setTimeout(
                    () => {
                        this.emit(sequentialTaskQueueEvents.timeout);
                        this.cancelTask(task, cancellationTokenReasons.timeout);
                    }, 
                    task.timeout
                );
            }

            const res: unknown = task.callback.apply(undefined, task.args);

            if (res && isPromise(res)) {
                res.then(
                    result => {
                        task.result = result;
                        this.doneTask(task);
                    },
                    err => this.doneTask(task, err)
                );
            } else {
                task.result = res;
                this.doneTask(task);
            }
        } catch (e) {
            this.doneTask(task, e);
        }
    }

    private cancelTask(task: TaskEntry, reason?: unknown): void {
        task.cancellationToken.cancelled = true;
        task.cancellationToken.reason = reason;
        this.doneTask(task);
    }

    private doneTask(task: TaskEntry, error?: unknown): void {
        if (task.timeoutHandle) {
            clearTimeout(task.timeoutHandle);
        }

        task.cancellationToken.cancel = noop;

        if (error) {
            this.emit(sequentialTaskQueueEvents.error, error);
            task.reject?.call(undefined, error);
        } else if (task.cancellationToken.cancelled) {
            task.reject?.call(undefined, task.cancellationToken.reason)
        } else {
            task.resolve?.call(undefined, task.result);
        }

        if (this.currentTask !== task) {
            return;
        }

        this.currentTask = undefined;

        if (!this.queue.length) {
            this.emit(sequentialTaskQueueEvents.drained);
            this.callWaiters();
        } else {
            this.scheduler.schedule(() => this.next());
        }
    }

    private callWaiters(): void {
        const waiters = this.waiters.splice(0);
        waiters.forEach(waiter => waiter());
    }
}

interface TaskEntry {
    args: unknown[];
    callback: Task;
    timeout?: number;
    timeoutHandle?: ReturnType<typeof setTimeout>;
    cancellationToken: CancellationToken;
    result?: unknown;
    resolve?(value: unknown): void;
    reject?(reason?: unknown): void;
}

function noop(): void {
}

function isPromise(obj: unknown): obj is PromiseLike<unknown> {
    return (
        obj !== null &&
        (typeof obj === 'object' || typeof obj === 'function') &&
        'then' in obj &&
        typeof obj.then === "function"
    );
}

SequentialTaskQueue.defaultScheduler = {
    schedule: typeof setImmediate === "function" 
        ? (callback): void => { setImmediate(callback); }
        : (callback): void => { setTimeout(callback, 0); }
};
