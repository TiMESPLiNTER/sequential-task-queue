import assert from "assert";
import { SequentialTaskQueue, CancellationToken } from "../src/sequential-task-queue";
import sinon from "sinon";

describe("Examples", () => {
    describe("Basic usage", () => {
        it("", () => {
            const consoleLogSpy = sinon.spy(console, "log");
            // --- snippet: Basic usage ---
            const queue = new SequentialTaskQueue();
            void queue.push(() => {
                console.log("first task");
            });
            void queue.push(() => {
                console.log("second task");
            });
            // --- snip --- 
            return queue.wait().then(() => {
                try {
                    assert.deepEqual(consoleLogSpy.args, [["first task"], ["second task"]]);
                } finally {
                    consoleLogSpy.restore();
                }
            });
        });
    });

    describe("Promises", () => {
        it("", () => {
            const consoleLogSpy = sinon.spy(console, "log");
            // --- snippet: Promises  --- 
            const queue = new SequentialTaskQueue();
            void queue.push(() => {
                console.log("1");
            });
            void queue.push(() => {
                return new Promise<void>(resolve => {
                    setTimeout(() => {
                        console.log("2");
                        resolve();
                    }, 500);
                });
            });
            void queue.push(() => {
                return new Promise((resolve, reject) => {
                    setTimeout(() => {
                        console.log("3");
                        reject(new Error("3 failed"));
                    }, 100);
                });
            });
            void queue.push(() => {
                console.log("4");
            });

            // Output:
            // 1
            // 2
            // 3
            // 4

            // --- snip ---
            return queue.wait().then(() => {
                try {
                    assert.deepEqual(consoleLogSpy.args, [["1"], ["2"], ["3"], ["4"]])
                } finally {
                    consoleLogSpy.restore();
                }
            });
        });
    });

    describe("Task cancellation", () => {
        it("", () => {
            // --- snippet: Task cancellation ---
            const queue = new SequentialTaskQueue();
            const task = queue.push((token: CancellationToken) => {
                return new Promise((resolve, _reject) => {
                    setTimeout(resolve, 100);
                }).then(() => new Promise<void>((resolve, reject) => {
                    if (token.cancelled) {
                        reject(new Error("cancelled"));
                    } else {
                        resolve();
                    }
                })).then(() => {
                    throw new Error("Should not ever get here");
                });
            });
            setTimeout(() => {
                task.cancel();
            }, 50);
            // --- snip ---
            return queue.wait();
        });
    });

    describe("Timeouts", () => {
        it("", function() {
            this.timeout(0);
            // --- snippet: Timeouts ---
            // --- snip ---
            const timeouts = [20, 2000, 10]; 
            const backend = {
                echo: (query: string): Promise<string> => new Promise<string>(resolve => {
                    setTimeout(() => resolve(query), timeouts.shift() || 0);
                }),
            };
            const state: { list: string[]; addResponse: (response: string) => void } = {
                list: [],
                addResponse: (response: string) => { 
                    state.list.push(response); 
                }
            };
            // --- snip ---
            const queue = new SequentialTaskQueue();
            // ...
            function onEcho(query: string): void {
                void queue.push((token: CancellationToken) => 
                    backend.echo(query).then(response => {
                        if (!token.cancelled) {
                            state.addResponse("Server responded: " + response);
                        }
                    }), { timeout: 1000 });
            }
            // --- snip ---
            onEcho("foo");
            onEcho("bar");
            onEcho("baz");
            return queue.wait().then(() => { assert.deepEqual(state.list, ["Server responded: foo", "Server responded: baz"]); });
        });
    });

    describe("Arguments", () => {
        it("Without using args", function() {
            let handler!: (...args: any[]) => void;
            const backend = {
                on: (evt: string, cb: (...args: any[]) => void): void => {
                    handler = cb;
                }
            };
            const consoleLogSpy = sinon.spy(console, "log");
            const queue = new SequentialTaskQueue();
            // --- snippet: Arguments 1 ---
            backend.on("notification", (data: string) => {
                void queue.push(() => {
                    console.log(data);
                    // todo: do something with data
                });
            });
            // --- snip ---
            handler(1);
            handler(3);
            handler(5);
            handler(7);
            return queue.wait().then(() => {
                try {
                    assert.deepEqual(consoleLogSpy.args, [[1], [3], [5], [7]]);
                } finally {
                    consoleLogSpy.restore();
                }
            });
        });

        it("With args", function() {
            let handler!: (...args: any[]) => void;
            const backend = {
                on: (evt: string, cb: (...args: any[]) => void): void => {
                    handler = cb;
                }
            };
            const consoleLogSpy = sinon.spy(console, "log");
            const queue = new SequentialTaskQueue();
            // --- snippet: Arguments 2 ---
            backend.on("notification", (data: string) => {
                void queue.push(handleNotifiation, { args: data });
            });

            function handleNotifiation(data: string): void {
                console.log(data);
                // todo: do something with data
            }
            // --- snip ---
            handler(1);
            handler(3);
            handler(5);
            handler(7);
            return queue.wait().then(() => {
                 try {
                    assert.deepEqual(consoleLogSpy.args, [[1], [3], [5], [7]]);
                } finally {
                    consoleLogSpy.restore();
                } 
            });
        });
    });

    describe("Waiting for all tasks to finish", () => {
        it("", () => {
            const task1 = (): void => {};
            const task2 = task1;
            const task3 = task2;
            // --- snippet: Wait ---
            const queue = new SequentialTaskQueue();
            void queue.push(task1);
            void queue.push(task2);
            void queue.push(task3);
            void queue.wait().then(() => { /*...*/ });
            // --- snip ---
        });
    });

    describe("Closing the queue", () => {
        it("", () => {
            // --- snippet: Close ---
            const queue = new SequentialTaskQueue();
            // ...
            function deactivate(done: () => void): void {
                void queue.close(true).then(done);                
            } 
            // --- snip ---
            void queue.push(() => new Promise(resolve => setTimeout(resolve, 500)));
            return new Promise<void>(resolve => {
                deactivate(resolve);
            });
        });
    });

    describe("Handling errors", () => {
        it("", () => {
            // --- snippet: Errors ---
            const queue = new SequentialTaskQueue();
            void queue.push(() => new Promise((resolve, _reject) => {
                setTimeout(resolve, 100);
            }).then(() => new Promise((_resolve, _reject) => {
                throw new Error("Epic fail");
            })));
            // --- snip ---
            const spy = sinon.spy();
            queue.on("error", spy);
            return queue.wait().then(() => assert(spy.called));
        });
    });
});

