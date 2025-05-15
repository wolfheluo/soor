document.addEventListener('DOMContentLoaded', function() {
  // 獲取DOM元素
  const fetchProductsBtn = document.getElementById('fetchProducts');
  const monitorStockToggle = document.getElementById('monitorStockToggle');
  const autoCheckoutToggle = document.getElementById('autoCheckoutToggle');
  const refreshIntervalInput = document.getElementById('refreshIntervalInput');
  const saveRefreshIntervalBtn = document.getElementById('saveRefreshInterval');
  const statusBox = document.getElementById('statusBox');
  const productList = document.getElementById('productList');
  const monitoredCount = document.getElementById('monitoredCount');
  
  // 載入初始設定
  loadInitialSettings();
  
  // 載入監控商品數量
  updateMonitoredProductsCount();
  
  // 設定按鈕事件監聽器
  fetchProductsBtn.addEventListener('click', viewMonitoredProducts);
  monitorStockToggle.addEventListener('change', toggleStockMonitoring);
  autoCheckoutToggle.addEventListener('change', toggleAutoCheckout);
  saveRefreshIntervalBtn.addEventListener('click', saveRefreshInterval);
  
  // 從背景腳本接收訊息
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.type === 'productsFetched') {
      displayProducts(message.products);
      updateStatus(`成功抓取了 ${message.products.length} 個商品`);
    } else if (message.type === 'stockUpdate') {
      updateStatus(`庫存更新: ${message.product.name} 現在${message.inStock ? '有庫存' : '缺貨'}`);
      // 如果有庫存且自動結帳開啟，則觸發購買
      if (message.inStock && message.autoCheckout) {
        updateStatus(`嘗試自動購買: ${message.product.name}`);
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'initiateCheckout',
          product: message.product
        });
      }
    } else if (message.type === 'checkoutComplete') {
      updateStatus(`結帳完成: ${message.success ? '成功' : '失敗'} - ${message.message}`);
    } else if (message.type === 'statusUpdate') {
      updateStatus(message.message);
      // 每次狀態更新時重新檢查監控商品數量
      updateMonitoredProductsCount();
      // 同時更新開關狀態
      updateSwitchStates();
    }
    
    // 始終回傳true以表示非同步回應
    return true;
  });
  
  // 查看監控商品
  function viewMonitoredProducts() {
    updateStatus('讀取監控商品列表...');
    chrome.storage.sync.get('monitoredProducts', function(data) {
      const products = data.monitoredProducts || [];
      displayProducts(products);
      updateStatus(`已顯示 ${products.length} 個監控中的商品`);
    });
  }
  
  // 更新監控商品數量
  function updateMonitoredProductsCount() {
    chrome.storage.sync.get('monitoredProducts', function(data) {
      const products = data.monitoredProducts || [];
      monitoredCount.textContent = `監控中商品：${products.length} 件`;
    });
  }
  
  // 更新開關狀態
  function updateSwitchStates() {
    chrome.runtime.sendMessage({type: 'checkMonitoringStatus'}, function(response) {
      if (response) {
        monitorStockToggle.checked = response.isMonitoring;
        autoCheckoutToggle.checked = response.autoCheckout;
      }
    });
  }
  // 切換庫存監控
  function toggleStockMonitoring() {
    const isMonitoring = monitorStockToggle.checked;
    const refreshInterval = parseInt(refreshIntervalInput.value, 10) || 30;
    
    if (isMonitoring) {
      // 開始監控
      chrome.runtime.sendMessage({
        type: 'startMonitoring',
        settings: {
          isMonitoring: true,
          autoCheckout: autoCheckoutToggle.checked,
          refreshInterval: refreshInterval
        }
      });
      
      updateStatus(`庫存監控已開始，將在當前頁面每 ${refreshInterval} 秒輪詢檢查庫存`);
    } else {
      // 停止監控
      chrome.runtime.sendMessage({type: 'stopMonitoring'});
      updateStatus('庫存監控已停止');
    }
  }
  
  // 切換自動結帳
  function toggleAutoCheckout() {
    const isAutoCheckout = autoCheckoutToggle.checked;
    
    if (isAutoCheckout) {
      // 啟用自動結帳
      chrome.runtime.sendMessage({type: 'setAutoCheckout', enabled: true});
      updateStatus('自動結帳已啟用，發現符合條件的商品時將自動購買');
    } else {
      // 停用自動結帳
      chrome.runtime.sendMessage({type: 'setAutoCheckout', enabled: false});
      updateStatus('自動結帳已停用');
    }
    
    // 如果監控已開啟，更新設定
    if (monitorStockToggle.checked) {
      chrome.runtime.sendMessage({
        type: 'updateSettings',
        settings: {
          isMonitoring: true,
          autoCheckout: isAutoCheckout
        }
      });
    }
  }
    // 載入初始設定
  function loadInitialSettings() {
    // 確保監控開關和自動結帳開關初始為關閉
    monitorStockToggle.checked = false;
    autoCheckoutToggle.checked = false;
    
    // 從背景腳本獲取實際的監控狀態
    updateSwitchStates();
    
    // 載入刷新間隔設定
    chrome.storage.sync.get('refreshInterval', function(data) {
      if (data.refreshInterval) {
        refreshIntervalInput.value = data.refreshInterval;
      } else {
        // 預設30秒
        refreshIntervalInput.value = 30;
        chrome.storage.sync.set({ refreshInterval: 30 });
      }
    });
    
    updateStatus('系統已就緒，開關預設為關閉狀態');
  }
  
  // 儲存刷新間隔設定
  function saveRefreshInterval() {
    const interval = parseInt(refreshIntervalInput.value, 10);
    
    // 確保輸入值在合理範圍內
    if (isNaN(interval) || interval < 5) {
      refreshIntervalInput.value = 5;
      updateStatus('刷新間隔最小為5秒');
      return;
    }
    
    if (interval > 300) {
      refreshIntervalInput.value = 300;
      updateStatus('刷新間隔最大為300秒');
      return;
    }
    
    // 儲存新的刷新間隔設定
    chrome.storage.sync.set({ refreshInterval: interval }, function() {
      updateStatus(`監控刷新間隔已設定為 ${interval} 秒`);
      
      // 如果監控已開啟，通知所有頁面更新刷新間隔
      if (monitorStockToggle.checked) {
        chrome.tabs.query({}, function(tabs) {
          for (let tab of tabs) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'updateRefreshInterval',
              interval: interval
            }, function(response) {
              // 忽略回應錯誤，有些頁面可能沒有內容腳本
            });
          }
        });
      }
    });
  }
  
  // 更新狀態訊息
  function updateStatus(message) {
    const timestamp = new Date().toLocaleTimeString();
    statusBox.innerHTML = `[${timestamp}] ${message}<br>` + statusBox.innerHTML;
  }
    // 顯示產品列表
  function displayProducts(products) {
    productList.innerHTML = '';
    
    if (products.length === 0) {
      productList.innerHTML = '<div class="product-item">未找到產品</div>';
      return;
    }
    
    products.forEach(product => {
      const productItem = document.createElement('div');
      productItem.className = 'product-item';
      productItem.innerHTML = `
        <div><strong>${product.name}</strong> - ${product.price}</div>
        <div>庫存狀態: ${product.inStock ? '<span style="color:green">有庫存</span>' : '<span style="color:red">無庫存</span>'}</div>
        ${product.sizes ? `<div>尺寸: ${product.sizes.join(', ')}</div>` : ''}
        ${product.color ? `<div>顏色: <span style="font-weight:bold">${product.color}</span></div>` : ''}
        <div>欲購買數量: <span style="font-weight:bold">${product.quantity || 1}</span> 件</div>
        <div><a href="${product.url}" target="_blank">查看商品</a></div>
      `;
      
      // 添加移除按鈕
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '移除監控';
      removeBtn.style.backgroundColor = '#f44336';
      removeBtn.style.padding = '4px 8px';
      removeBtn.style.marginTop = '5px';
      removeBtn.style.fontSize = '12px';
      
      removeBtn.addEventListener('click', function() {
        removeMonitoredProduct(product);
      });
      
      productItem.appendChild(removeBtn);
      productList.appendChild(productItem);
    });
  }
    // 移除監控商品
  function removeMonitoredProduct(product) {
    chrome.storage.sync.get('monitoredProducts', function(data) {
      const products = data.monitoredProducts || [];
      const updatedProducts = products.filter(p => p.url !== product.url);
      
      chrome.storage.sync.set({monitoredProducts: updatedProducts}, function() {
        updateStatus(`已移除監控商品: ${product.name}`);
        // 通知背景腳本產品已被移除
        chrome.runtime.sendMessage({type: 'productRemoved'}, function() {
          viewMonitoredProducts(); // 重新顯示更新後的列表
          updateMonitoredProductsCount(); // 更新數量顯示
        });
      });
    });
  }
});