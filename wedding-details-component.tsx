import React, { useState } from 'react';

const WeddingDetails = () => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-4xl font-bold mb-4">WEDDING DETAILS</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Wedding Details / Location */}
        <div className="bg-blue-100 rounded-lg overflow-hidden">
          <img 
            src="/api/placeholder/800/400" 
            alt="Wedding location" 
            className="w-full h-64 object-cover"
          />
        </div>

        {/* Right Column */}
        <div className="space-y-4">
          {/* Registry */}
          <div 
            className="bg-gray-200 rounded-lg p-4 relative overflow-hidden"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <h2 className="text-2xl font-bold mb-2">REGISTRY</h2>
            {!isHovered && (
              <img 
                src="/api/placeholder/400/200" 
                alt="Registry items" 
                className="w-full h-32 object-cover"
              />
            )}
            {isHovered && (
              <div className="absolute inset-0 bg-black bg-opacity-70 text-white p-4 transition-opacity duration-300">
                <p className="text-sm">
                  Sharing a homemade meal at a table full of family & friends is one of our favorite things to do. We have created a registry with Heath Ceramics, a Bay Area studio that we love. We hope to share these pieces with you at future tables and with every meal, remember our wedding.
                </p>
              </div>
            )}
          </div>

          {/* Places to Visit */}
          <div className="bg-blue-100 rounded-lg p-4">
            <h2 className="text-2xl font-bold mb-2">PLACES TO VISIT</h2>
            <img 
              src="/api/placeholder/400/200" 
              alt="Places to visit" 
              className="w-full h-32 object-cover rounded"
            />
          </div>

          {/* The Invitation */}
          <div className="bg-yellow-100 rounded-lg p-4">
            <h2 className="text-2xl font-bold mb-2">THE INVITATION</h2>
            <img 
              src="/api/placeholder/400/200" 
              alt="Invitation" 
              className="w-full h-32 object-cover rounded"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeddingDetails;
