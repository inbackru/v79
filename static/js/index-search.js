console.log('🔍 index-search.js loading...');

document.addEventListener('DOMContentLoaded', function() {
    const heroSearchInput = document.getElementById('hero-search');
    const heroSearchBtn = document.getElementById('hero-search-btn');
    
    if (!heroSearchInput || !heroSearchBtn) {
        console.warn('⚠️ Hero search elements not found');
        return;
    }
    
    function performHeroSearch() {
        const query = heroSearchInput.value.trim();
        
        if (!query) {
            console.log('⚠️ Empty search query');
            return;
        }
        
        console.log('🔍 Hero search initiated:', query);
        
        const url = `/properties?q=${encodeURIComponent(query)}`;
        console.log('➡️ Redirecting to:', url);
        window.location.href = url;
    }
    
    heroSearchBtn.addEventListener('click', function(e) {
        e.preventDefault();
        performHeroSearch();
    });
    
    heroSearchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            performHeroSearch();
        }
    });
    
    console.log('✅ Hero search handlers initialized');
});
