document.addEventListener('DOMContentLoaded', function() {
  // 獲取DOM元素
  const fetchProductsBtn = document.getElementById('fetchProducts');
  const monitorStockToggle = document.getElementById('monitorStockToggle');
  const autoCheckoutToggle = document.getElementById('autoCheckoutToggle');
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
  
  // 切換庫存監控
  function toggleStockMonitoring() {
    const isMonitoring = monitorStockToggle.checked;
    
    if (isMonitoring) {
      // 開始監控
      chrome.runtime.sendMessage({
        type: 'startMonitoring',
        settings: {
          isMonitoring: true,
          autoCheckout: autoCheckoutToggle.checked
        }
      });
      
      updateStatus('庫存監控已開始，監控間隔: 30秒');
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
    // 確保監控開關和自動結帳開關預設為關閉
    monitorStockToggle.checked = false;
    autoCheckoutToggle.checked = false;
    
    // 載入自動結帳設定 (僅用於顯示歷史設定，每次都會預設為關閉)
    chrome.storage.sync.get('autoCheckout', function(data) {
      // 即使之前的設定是開啟的，我們仍然每次都設為關閉
      autoCheckoutToggle.checked = false;
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
        viewMonitoredProducts(); // 重新顯示更新後的列表
        updateMonitoredProductsCount(); // 更新數量顯示
      });
    });
  }
});