// Live test start button hook (extracted from inline script)

                    // Immediately attach click handler after button is created
                    (function() {
                        var btn = document.getElementById('btn-start-test');
                        if (btn) {
                            btn.addEventListener('click', function() {
                                console.log('[BUTTON CLICK] Handler fired, calling startLiveTest()');
                                this.style.border = '3px solid lime';
                                this.innerHTML = '<span>⚡</span> Starting...';
                                // Call the actual function (defined later in script)
                                if (typeof startLiveTest === 'function') {
                                    startLiveTest();
                                } else {
                                    console.error('[BUTTON CLICK] startLiveTest not defined yet!');
                                }
                            });
                            console.log('[INIT] Button click handler attached immediately');
                        }
                    })();
