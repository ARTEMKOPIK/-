using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace MaxTelegramBot
{
	public sealed class MaxWebAutomation : IAsyncDisposable
	{
		private readonly ClientWebSocket _webSocket = new ClientWebSocket();
		private readonly CancellationTokenSource _cts = new CancellationTokenSource();
		private int _messageId;

		public static async Task<MaxWebAutomation> ConnectAsync(string userDataDir, string pageUrlContains, int timeoutMs = 15000, JObject? additionalSettings = null)
		{
			var portFile = Path.Combine(userDataDir, "DevToolsActivePort");
			var sw = Stopwatch.StartNew();
			while (!File.Exists(portFile))
			{
				await Task.Delay(200);
				if (sw.ElapsedMilliseconds > timeoutMs)
					throw new Exception("DevToolsActivePort not found. Make sure Chrome started with --remote-debugging-port=0");
			}

			var lines = await File.ReadAllLinesAsync(portFile);
			if (lines.Length == 0)
				throw new Exception("DevToolsActivePort file is empty");
			if (!int.TryParse(lines[0], out var port))
				throw new Exception("Invalid DevTools port value");

			string wsDebuggerUrl;
			using (var http = new HttpClient())
			{
				var json = await http.GetStringAsync($"http://127.0.0.1:{port}/json");
				var arr = JArray.Parse(json);
				wsDebuggerUrl = (arr.FirstOrDefault(x => x["type"]?.ToString() == "page" && (x["url"]?.ToString()?.Contains(pageUrlContains) ?? false))?
					["webSocketDebuggerUrl"])?.ToString();
				if (string.IsNullOrEmpty(wsDebuggerUrl))
				{
					wsDebuggerUrl = (arr.FirstOrDefault(x => x["type"]?.ToString() == "page")?
						["webSocketDebuggerUrl"])?.ToString();
				}
			}
			if (string.IsNullOrEmpty(wsDebuggerUrl))
				throw new Exception("No page target found for DevTools");

			var client = new MaxWebAutomation();
			await client._webSocket.ConnectAsync(new Uri(wsDebuggerUrl), client._cts.Token);
			await client.EnableBasicDomainsAsync();
			
			// Применяем оптимизации для экономии ресурсов
			if (additionalSettings != null)
			{
				await client.ApplyOptimizationsAsync(additionalSettings);
			}
			
			return client;
		}

		public async Task EnableBasicDomainsAsync()
		{
			await SendAsync("Page.enable");
			await SendAsync("Runtime.enable");
			await SendAsync("DOM.enable");
			await SendAsync("Network.enable");
		}

		public async Task SetUserAgentAsync(string userAgent)
		{
			await SendAsync("Network.setUserAgentOverride", new JObject
			{
				["userAgent"] = userAgent
			});
		}

		private static readonly string[] _userAgentTemplates = {
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
		};

		public async Task SetRandomUserAgentAsync()
		{
			var random = new Random();
			var template = _userAgentTemplates[random.Next(_userAgentTemplates.Length)];
			// Добавляем небольшую вариацию в версию Chrome
			var chromeVersion = random.Next(118, 124);
			var patchVersion = random.Next(0, 10);
			var userAgent = template.Replace("Chrome/120.0.0.0", $"Chrome/{chromeVersion}.0.{patchVersion}.0");
			await SetUserAgentAsync(userAgent);
		}

		public async Task ApplyOptimizationsAsync(JObject settings)
		{
			try
			{
				// Отключаем ненужные домены для экономии ресурсов
				await SendAsync("Page.setBypassCSP", new JObject { ["enabled"] = true });
				await SendAsync("Page.setLifecycleEventsEnabled", new JObject { ["enabled"] = false });
				await SendAsync("Page.setInterceptFileChooserDialog", new JObject { ["enabled"] = false });
				
				// Отключаем сетевые события
				await SendAsync("Network.setBypassServiceWorker", new JObject { ["bypass"] = true });
				await SendAsync("Network.setCacheDisabled", new JObject { ["cacheDisabled"] = true });
				
				// Отключаем логирование
				await SendAsync("Runtime.setAsyncCallStackDepth", new JObject { ["maxDepth"] = 0 });
				
				// Устанавливаем ограничения на память
				await SendAsync("Runtime.setMaxCallStackSize", new JObject { ["size"] = 100 });
				
				Console.WriteLine("[MAX] ✅ Оптимизации применены");
			}
			catch (Exception ex)
			{
				Console.WriteLine($"[MAX] ⚠️ Ошибка применения оптимизаций: {ex.Message}");
			}
		}

		public async Task FocusSelectorAsync(string cssSelector)
		{
			var expr = $"document.querySelector('{EscapeJs(cssSelector)}')?.focus()";
			await SendAsync("Runtime.evaluate", new JObject
			{
				["expression"] = expr,
				["awaitPromise"] = false
			});
		}

		public async Task ClearInputAsync(string cssSelector)
		{
			var expr = "(function(){var el=document.querySelector('" + EscapeJs(cssSelector) + "'); if(el){el.value=''; el.dispatchEvent(new Event('input',{bubbles:true}));}})()";
			await SendAsync("Runtime.evaluate", new JObject
			{
				["expression"] = expr,
				["awaitPromise"] = false
			});
		}

		public async Task ClearInputAsync()
		{
			await SendAsync("Input.clear", new JObject());
		}

		public async Task TypeTextAsync(string text)
		{
			await SendAsync("Input.insertText", new JObject
			{
				["text"] = text
			});
		}

		public async Task ClickSelectorAsync(string cssSelector)
		{
			var expr = "(function(){var el=document.querySelector('" + EscapeJs(cssSelector) + "'); if(el){el.click(); return true;} return false;})()";
			await SendAsync("Runtime.evaluate", new JObject
			{
				["expression"] = expr,
				["awaitPromise"] = true,
				["returnByValue"] = true
			});
		}

		public async Task<bool> WaitForSelectorAsync(string cssSelector, int timeoutMs = 15000, int pollMs = 250)
		{
			var sw = Stopwatch.StartNew();
			while (sw.ElapsedMilliseconds < timeoutMs)
			{
				var resp = await SendAsync("Runtime.evaluate", new JObject
				{
					["expression"] = "document.querySelector('" + EscapeJs(cssSelector) + "')!=null",
					["awaitPromise"] = false,
					["returnByValue"] = true
				});
				var result = resp?["result"]?["value"]?.Value<bool?>();
				if (result == true) return true;
				await Task.Delay(pollMs);
			}
			return false;
		}

		public async Task<bool> WaitForBodyTextContainsAsync(string substring, int timeoutMs = 15000, int pollMs = 250)
		{
			var sw = Stopwatch.StartNew();
			while (sw.ElapsedMilliseconds < timeoutMs)
			{
				var resp = await SendAsync("Runtime.evaluate", new JObject
				{
					["expression"] = "(function(s){var b=document.body; if(!b) return false; var t=(b.innerText||'').toLowerCase(); return t.indexOf(s.toLowerCase())>=0;})(" + JsonConvert.SerializeObject(substring) + ")",
					["awaitPromise"] = true,
					["returnByValue"] = true
				});
				var result = resp?["result"]?["value"]?.Value<bool?>();
				if (result == true) return true;
				await Task.Delay(pollMs);
			}
			return false;
		}

		public async Task<bool> TypeIntoFirstVisibleTextInputAsync(string text)
		{
                        var expr = "(function(txt){"+
                                      "function vis(el){var s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden')return false;var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}"+
                                      "var inputs=Array.from(document.querySelectorAll('input')).filter(function(el){var t=(el.getAttribute('type')||'').toLowerCase();return (t===''||t==='text'||t==='tel')&&vis(el);});"+
                                      "for(var i=0;i<inputs.length;i++){var el=inputs[i];try{"+
                                      "el.focus();"+
                                      "el.value='';"+
                                      "el.dispatchEvent(new Event('input',{bubbles:true}));"+
                                      "el.value=txt;"+
                                      "el.dispatchEvent(new Event('input',{bubbles:true}));"+
                                      "el.dispatchEvent(new Event('change',{bubbles:true}));"+
                                      "return true;"+
                                      "}catch(e){}}"+
                                      "return false;"+
                                      "})(" + JsonConvert.SerializeObject(text) + ")";
			var resp = await SendAsync("Runtime.evaluate", new JObject
			{
				["expression"] = expr,
				["awaitPromise"] = true,
				["returnByValue"] = true
			});
			return resp?["result"]?["value"]?.Value<bool?>() == true;
		}

		public async Task<bool> ClickButtonByTextAsync(string containsText)
		{
			var expr = "(function(t){t=t.toLowerCase();var btns=Array.from(document.querySelectorAll(\"button,[role='button']\"));for(var i=0;i<btns.length;i++){var el=btns[i];var txt=(el.textContent||'').trim().toLowerCase();if(txt.indexOf(t)>=0){el.click();return true;}}return false;})(" + JsonConvert.SerializeObject(containsText) + ")";
			var resp = await SendAsync("Runtime.evaluate", new JObject
			{
				["expression"] = expr,
				["awaitPromise"] = true,
				["returnByValue"] = true
			});
			return resp?["result"]?["value"]?.Value<bool?>() == true;
		}

		public async Task<bool> FillOtpInputsAsync(string digits)
		{
			var expr = "(function(code){"+
				"var selectors=['div.code input','input.digit','input[type=number].digit','input[type=number]'];"+
				"var inputs=null;"+
				"for(var i=0;i<selectors.length;i++){var list=document.querySelectorAll(selectors[i]); if(list&&list.length){inputs=list; if(list.length>=code.length) break;}}"+
				"if(!inputs||inputs.length===0) return false;"+
				"for(var i=0;i<code.length && i<inputs.length;i++){var el=inputs[i]; try{el.focus(); el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); el.value=code[i]; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}}"+
				"return true;"+
			"})(" + JsonConvert.SerializeObject(digits) + ")";
			var resp = await SendAsync("Runtime.evaluate", new JObject
			{
				["expression"] = expr,
				["awaitPromise"] = true,
				["returnByValue"] = true
			});
			return resp?["result"]?["value"]?.Value<bool?>() == true;
		}

		public async Task<bool> SubmitFormBySelectorAsync(string formSelector)
		{
			var expr = "(function(sel){var f=document.querySelector(sel); if(!f) return false; if(typeof f.requestSubmit==='function'){f.requestSubmit(); return true;} try{f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); if(typeof f.submit==='function') f.submit(); return true;}catch(e){return false;}})(" + JsonConvert.SerializeObject(formSelector) + ")";
			var resp = await SendAsync("Runtime.evaluate", new JObject
			{
				["expression"] = expr,
				["awaitPromise"] = true,
				["returnByValue"] = true
			});
			return resp?["result"]?["value"]?.Value<bool?>() == true;
		}

		public async Task PressEnterAsync()
		{
			var expr = "(function(){function fire(target,type){var e=new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}); target.dispatchEvent(e);} var a=document.activeElement||document.body; if(a){fire(a,'keydown');fire(a,'keyup');} fire(document,'keydown'); fire(document,'keyup'); return true;})()";
			await SendAsync("Runtime.evaluate", new JObject
			{
				["expression"] = expr,
				["awaitPromise"] = true,
				["returnByValue"] = true
			});
		}

		public async Task<JToken> SendAsync(string method, JObject? parameters = null)
		{
			var id = Interlocked.Increment(ref _messageId);
			var obj = new JObject
			{
				["id"] = id,
				["method"] = method
			};
			if (parameters != null)
				obj["params"] = parameters;

			var json = obj.ToString(Formatting.None);
			var buffer = Encoding.UTF8.GetBytes(json);
			await _webSocket.SendAsync(new ArraySegment<byte>(buffer), WebSocketMessageType.Text, true, _cts.Token);

			// Read until we get the matching id response, ignore events
			var readBuffer = new byte[1 << 16];
			while (true)
			{
				var ms = new MemoryStream();
				WebSocketReceiveResult result;
				do
				{
					result = await _webSocket.ReceiveAsync(new ArraySegment<byte>(readBuffer), _cts.Token);
					ms.Write(readBuffer, 0, result.Count);
				}
				while (!result.EndOfMessage);
				var text = Encoding.UTF8.GetString(ms.ToArray());
				var jt = JToken.Parse(text);
				if (jt["id"]?.Value<int>() == id)
					return jt;
				// else it's an event; continue reading
			}
		}

		private static string EscapeJs(string s)
		{
			return s.Replace("\\", "\\\\").Replace("'", "\\'");
		}

		public async Task CloseBrowserAsync()
		{
			try
			{
				// Отправляем команду на закрытие браузера через CDP
				await SendAsync("Browser.close");
			}
			catch
			{
				// Игнорируем ошибки при закрытии
			}
			
			// НЕ убиваем все процессы Chrome - это закрывает браузеры других номеров!
			// Вместо этого полагаемся на CDP команду Browser.close
		}

		public async ValueTask DisposeAsync()
		{
			try { _cts.Cancel(); } catch { }
			try { _webSocket.Dispose(); } catch { }
			await Task.CompletedTask;
		}
	}
} 