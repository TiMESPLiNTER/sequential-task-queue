import assert from "assert";
import { SequentialTaskQueue, CancellationToken } from "../src/sequential-task-queue";
import sinon from "sinon";

process.on('unhandledRejection', () => {
  console.log('Suppressed unhandled rejection');
});

describe("SequentialTaskQueue", () => {

    it("should execute a task", () => {
        const queue = new SequentialTaskQueue();
        const spy = sinon.spy();
        queue.push(spy);
        return queue.wait().then(() => { assert(spy.called); });
    });

    it("should execute a task with args (array)", () => {
        const queue = new SequentialTaskQueue();
        const spy = sinon.spy();
        queue.push(spy, { args: [1, 2, 3] });
        queue.push(spy, { args: [4, 5, 6] });
        return queue.wait().then(() => {
            assert(spy.callCount == 2);
            assert.deepEqual(spy.args[0].slice(0, 3), [1, 2, 3]);
            assert.deepEqual(spy.args[1].slice(0, 3), [4, 5, 6]);
        });
    });

    it("should execute a task with args (single value)", () => {
        const queue = new SequentialTaskQueue();
        const spy = sinon.spy();
        queue.push(spy, { args: "foo" });
        queue.push(spy, { args: "bar" });
        return queue.wait().then(() => {
            assert(spy.callCount == 2);
            assert.deepEqual(spy.args[0].slice(0, 1), ["foo"]);
            assert.deepEqual(spy.args[1].slice(0, 1), ["bar"]);
        });
    });

    it("should execute a chain of tasks", function () {

        this.timeout(0);

        const results: number[] = [];

        function createTask(id: number): () => void {
            return () => {
                results.push(id);
            };
        }

        function createAsyncTask(id: number): () => Promise<void> {
            return () => new Promise<void>(resolve => {
                results.push(id);
                resolve();
            });
        }

        function createScheduledTask(id: number): () => Promise<void> {
            return () => new Promise<void>(resolve => {
                setTimeout(() => {
                    results.push(id);
                    resolve();
                }, Math.floor(Math.random() * 100));
            });
        }

        const functions: ((id: number) => (() => void | Promise<void>))[] = [createTask, createAsyncTask, createScheduledTask];

        const queue = new SequentialTaskQueue();
        const count = 10;
        const expected: number[] = [];
        let idx = 0;
        while (idx < count) {
            for (let i = 0; i < functions.length; i++) {
                for (let j = 0; j < functions.length; j++) {
                    expected.push(idx);
                    queue.push(functions[i](idx));
                    idx++;
                    expected.push(idx);
                    queue.push(functions[j](idx));
                    idx++;
                }
            }
        }
        return queue.wait().then(() => assert.deepEqual(results, expected));

    });

    describe("# push: Promise", () => {

        it("should resolve when task is done", () => {
            const queue = new SequentialTaskQueue();
            const p = queue.push(() => {
                return 123;
            });
            return p.then(result => assert.equal(result, 123));
        });

        it("should resolve when async task is done", () => {
            const queue = new SequentialTaskQueue();
            const p = queue.push(() => {
                return new Promise(resolve => setTimeout(() => resolve(123), 100));
            });
            return p.then(result => assert.equal(result, 123));
        });

        it("should reject when task is cancelled", () => {
            const queue = new SequentialTaskQueue();
            const p = queue.push(() => {
                return new Promise(resolve => setTimeout(() => resolve(123), 200));
            });
            setTimeout(() => p.cancel("meh"), 50);
            return p.then(() => assert.ok(false), (reason) => assert.equal(reason, "meh"));
        });

        it("should reject when task fails", () => {
            const queue = new SequentialTaskQueue();
            const p = queue.push(() => {
                // intentionally throwing a non-Error value: the queue must pass through
                // whatever was thrown, unmodified, without requiring an Error instance
                // eslint-disable-next-line @typescript-eslint/only-throw-error
                throw "fail";
            });
            return p.then(() => assert.ok(false), (reason) => assert.equal(reason, "fail"));
        });

    });

    describe("# wait", () => {
        it("should resolve when queue is empty", () => {
            const queue = new SequentialTaskQueue();
            return queue.wait();
        });

        it("should resolve after synchronous task", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();
            queue.push(() => { spy(); });
            return queue.wait().then(() => assert(spy.called));
        });

        it("should resolve after previously resolved Promise", () => {
            const queue = new SequentialTaskQueue();
            queue.push(() => Promise.resolve());
            return queue.wait();
        });

        it("should resolve after resolved Promise", () => {
            const queue = new SequentialTaskQueue();
            queue.push(() => new Promise<void>(resolve => { resolve(); }));
            return queue.wait();
        });

        it("should resolve after resolved deferred Promise", () => {
            const queue = new SequentialTaskQueue();
            queue.push(() => new Promise(resolve => {
                setTimeout(resolve, 50);
            }));
            return queue.wait();
        });

        it("should resolve after throw", () => {
            const queue = new SequentialTaskQueue();
            queue.push(() => {
                throw new Error();
            });
            return queue.wait();
        });

        it("should resolve after previously rejected Promise", () => {
            const queue = new SequentialTaskQueue();
            queue.push(() => Promise.reject(new Error("rejected")));
            return queue.wait();
        });

        it("should resolve after rejected Promise", () => {
            const queue = new SequentialTaskQueue();
            queue.push(() => new Promise((resolve, reject) => {
                reject(new Error("rejected"));
            }));
            return queue.wait();
        });

        it("should resolve after rejected deferred Promise", () => {
            const queue = new SequentialTaskQueue();
            queue.push(() => new Promise((resolve, reject) => {
                setTimeout(reject, 50);
            }));
            return queue.wait();
        });

        it("should resolve after multiple calls", () => {
            const queue = new SequentialTaskQueue();
            queue.push(() => new Promise((resolve, _reject) => {
                setTimeout(resolve, 50);
            }));
            const p1 = queue.wait();
            const p2 = queue.wait();
            const p3 = queue.wait().then(() => queue.wait());
            return Promise.all([p1, p2, p3]);
        });

        it("should resolve after cancel", () => {
            const queue = new SequentialTaskQueue();
            queue.push(() => new Promise((resolve, _reject) => {
                setTimeout(resolve, 50);
            }));
            queue.push(() => { });
            const p = queue.wait();
            queue.cancel();
            return p;
        });
    });

    // These tests intentionally use non-Error throw/reject values to verify the queue
    // passes through whatever was thrown/rejected, unmodified, without requiring an
    // Error instance (see CancellationToken.reason docs: "arbitrary object ... or an
    // Error, etc").
    describe("# event: error", () => {

        it("should notify of thrown error", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();
            queue.on("error", spy);
            queue.push(() => {
                // eslint-disable-next-line @typescript-eslint/only-throw-error
                throw "fail";
            });
            return queue.wait().then(() => { assert(spy.calledWith("fail")); });
        });

        it("should notify of previously rejected Promise", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();
            queue.on("error", spy);
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            queue.push(() => Promise.reject("rejected"));
            return queue.wait().then(() => assert(spy.calledWith("rejected")));
        });

        it("should notify of rejected Promise", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();
            queue.on("error", spy);
            queue.push(() => new Promise((resolve, reject) => {
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                reject("rejected");
            }));
            return queue.wait().then(() => assert(spy.calledWith("rejected")));
        });

        it("should notify of rejected deferred Promise", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();
            queue.on("error", spy);
            queue.push(() => new Promise((resolve, reject) => {
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                setTimeout(() => reject("rejected"), 50);
            }));
            return queue.wait().then(() => assert(spy.calledWith("rejected")));
        });

        it("should catch and report exception in handler", () => {
            const queue = new SequentialTaskQueue();
            const consoleErrorSpy = sinon.spy(console, "error");
            queue.on("error", () => {
                // eslint-disable-next-line @typescript-eslint/only-throw-error
                throw "Outer error";
            });
            queue.push(() => {
                // eslint-disable-next-line @typescript-eslint/only-throw-error
                throw "Inner error";
            });
            return queue.wait().then(() => {
                try {
                    // hard coded this error message, see SequentialTaskQueue.emit if this test fails
                    assert(consoleErrorSpy.calledWith("SequentialTaskQueue: Exception in 'error' event handler", "Outer error"));
                } finally {
                    consoleErrorSpy.restore();
                }
            });
        });
    });

    describe("# event: drained", () => {

        it("should notify when single-task chain has finished", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();
            queue.on("drained", spy);
            queue.push(() => { });
            return queue.wait().then(() => { assert(spy.called); });
        });

        it("should notify when all tasks have finished", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();
            queue.on("drained", () => { spy("drained"); });
            queue.push(() => {
                spy(1);
            });
            queue.push(() => new Promise<void>(resolve => {
                setTimeout(() => {
                    spy(2);
                    resolve();
                }, 10)
            }));
            queue.push(() => {
                spy(3);
            });
            return queue.wait().then(() => { assert.deepEqual(spy.args, [[1], [2], [3], ["drained"]]); });
        });

        it("should notify after cancel", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();
            queue.on("drained", () => { spy("drained"); });
            queue.push(() => { spy(1) });
            queue.push(() => { spy(2) });
            return queue.cancel().then(() => { assert.deepEqual(spy.args, [["drained"]]); });
        });

        it("should not notify when empty queue is cancelled", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();
            queue.on("drained", spy);
            return queue.cancel().then(() => { assert(spy.notCalled); });
        });
    });

    describe("# event: timeout", () => {
        it("should notify on timeout", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();
            queue.on("timeout", () => { spy("timeout"); });
            queue.push((ct: CancellationToken) => new Promise<void>(resolve => {
                setTimeout(() => {
                    if (!ct.cancelled) {
                        spy("hello");
                        resolve();
                    }
                }, 500);
            }), { timeout: 100 });
            return queue.wait().then(() => { assert.deepEqual(spy.args, [["timeout"]]) });
        });
    });

    describe("# cancel", () => {

        it("should prevent queued tasks from running", () => {
            const queue = new SequentialTaskQueue();
            const res: number[] = [];
            queue.push(() => res.push(1));
            queue.push(() => new Promise<void>(resolve => {
                setTimeout(() => {
                    res.push(2);
                    resolve();
                }, 50);
            }));
            queue.push(() => new Promise<void>(resolve => {
                setTimeout(() => {
                    res.push(3);
                    resolve();
                }, 10);
            }));
            return queue.cancel().then(() => {
                assert.deepEqual(res, []);
            });
        });

        it("should cancel current task", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();

            queue.push((ct: CancellationToken) => {
                queue.cancel();
                if (ct.cancelled) {
                    return;
                }
                spy();
            });
            return queue.wait().then(() => assert(spy.notCalled));
        });

        it("should reject queued tasks with the given reason", () => {
            const queue = new SequentialTaskQueue();
            const p = queue.push(() => new Promise(resolve => setTimeout(resolve, 200)));
            const p2 = queue.push(() => { });
            queue.cancel("meh");
            return Promise.all([
                p.then(() => assert.ok(false), reason => assert.equal(reason, "meh")),
                p2.then(() => assert.ok(false), reason => assert.equal(reason, "meh"))
            ]);
        });

        it("should cancel current deferred task", () => {
            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();

            queue.push((ct: CancellationToken) =>
                new Promise<void>((resolve, reject) => {
                    setTimeout(() => {
                        // cancel() should not have been cancelled at this point
                        if (ct.cancelled) {
                            reject(new Error("cancelled"));
                        } else {
                            spy(1);
                            resolve();
                        }
                    },
                        10);
                }).then(() => new Promise<void>((resolve, reject) => {
                    setTimeout(() => {
                        // cancel() should have been cancelled at this point
                        if (ct.cancelled) {
                            reject(new Error("cancelled"));
                        } else {
                            spy(2);
                            resolve();
                        }
                    },
                        100);
                })));
            setTimeout(() => { queue.cancel(); }, 50);
            return queue.wait().then(() => {
                assert(spy.calledWith(1) && !spy.calledWith(2));
            });
        });
    });

    describe("# timeout",
        () => {
            it("should cancel task after timeout",
                () => {
                    const queue = new SequentialTaskQueue();
                    const spy = sinon.spy();

                    function pushTask(id: number, delay: number): void {
                        queue.push((ct: CancellationToken) => new Promise<void>(resolve => {
                            setTimeout(() => {
                                if (!ct.cancelled) {
                                    spy(id);
                                }
                                resolve();
                            }, delay)
                        }), { timeout: 200 });
                    }

                    pushTask(1, 50);
                    pushTask(2, 500);
                    pushTask(3, 50);

                    return queue.wait().then(() => {
                        assert.deepEqual(spy.args, [[1], [3]]);
                    });
                });
        });

    describe("# close", () => {

        it("should prevent adding more tasks", () => {

            const queue = new SequentialTaskQueue();
            queue.push(() => { });
            queue.close();
            assert.throws(() => {
                queue.push(() => { });
            });

        });

        it("should execute remaining tasks", () => {

            const queue = new SequentialTaskQueue();
            const res: number[] = [];
            queue.push(() => res.push(1));
            queue.push(() => res.push(2));
            queue.close();
            try {
                queue.push(() => res.push(3));
            } catch {
                // expected: queue is closed
            }
            return queue.wait().then(() => { assert.deepEqual(res, [1, 2]); });
        });

    });

    describe("# once", () => {

        it("should register single-shot event handler", () => {

            const queue = new SequentialTaskQueue();
            const spy = sinon.spy();
            queue.once("error", spy);
            queue.push(() => { throw new Error("1"); });
            queue.push(() => { throw new Error("2"); });
            return queue.wait().then(() => assert(spy.calledOnce));
        });

    });
});

describe("CancellationToken", () => {
    describe("# cancel", () => {
        it("should prevent task from running", () => {
            const queue = new SequentialTaskQueue();
            const res: number[] = [];
            queue.push(() => res.push(1));
            const ct = queue.push(() => res.push(2));
            queue.push(() => res.push(3));
            ct.cancel();
            return queue.wait().then(() => {
                assert.deepEqual(res, [1, 3]);
            });
        });

        it("should cancel running task and execute the next one immediately", () => {
            const clock = sinon.useFakeTimers();
            try {
                const queue = new SequentialTaskQueue();
                const res: number[] = [];
                queue.push(() => res.push(1));
                const ct = queue.push((token: CancellationToken) => new Promise<void>((resolve, reject) => {
                    if (token.cancelled) {
                        reject(new Error("cancelled"));
                    }
                    setTimeout(() => {
                        if (token.cancelled) {
                            reject(new Error("cancelled"));
                        } else {
                            res.push(2);
                            resolve();
                        }
                    }, 500);
                }));
                queue.push(() => res.push(3));
                clock.tick(100);
                ct.cancel();
                clock.tick(1000);
                assert.deepEqual(res, [1, 3]);
                queue.wait();
            } finally {
                clock.restore();
            }
        });
    });
});